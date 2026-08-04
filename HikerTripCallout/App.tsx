import { StatusBar } from 'expo-status-bar';
import { Accelerometer } from 'expo-sensors';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

type Sensitivity = 'low' | 'medium' | 'high';
type SensorSubscription = { remove: () => void };

type DetectionProfile = {
  label: string;
  freeFallG: number;
  impactG: number;
  destabilizingJerkG: number;
  impactJerkG: number;
  windowMs: number;
};

const DETECTION_PROFILES: Record<Sensitivity, DetectionProfile> = {
  low: {
    label: 'Fewer triggers',
    freeFallG: 0.42,
    impactG: 2.75,
    destabilizingJerkG: 1.45,
    impactJerkG: 1.5,
    windowMs: 700,
  },
  medium: {
    label: 'Balanced',
    freeFallG: 0.58,
    impactG: 2.25,
    destabilizingJerkG: 1.2,
    impactJerkG: 1.2,
    windowMs: 900,
  },
  high: {
    label: 'More sensitive',
    freeFallG: 0.72,
    impactG: 1.9,
    destabilizingJerkG: 0.95,
    impactJerkG: 0.9,
    windowMs: 1100,
  },
};

const TRIP_COOLDOWN_MS = 4500;
const SENSOR_INTERVAL_MS = 50;

export default function App() {
  const [monitoring, setMonitoring] = useState(false);
  const [sensorAvailable, setSensorAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState('Ready');
  const [tripCount, setTripCount] = useState(0);
  const [lastCallout, setLastCallout] = useState('—');
  const [magnitudeG, setMagnitudeG] = useState(1);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');

  const subscriptionRef = useRef<SensorSubscription | null>(null);
  const candidateAtRef = useRef<number | null>(null);
  const lastMagnitudeRef = useRef(1);
  const lastTripAtRef = useRef(0);
  const calloutIndexRef = useRef(0);
  const sensitivityRef = useRef<Sensitivity>('medium');

  useEffect(() => {
    sensitivityRef.current = sensitivity;
    candidateAtRef.current = null;
  }, [sensitivity]);

  const playCallout = useCallback(async (source: 'trip' | 'test') => {
    const phrases = ['Hee hee!', 'Hoo hoo!'];
    const phrase = phrases[calloutIndexRef.current % phrases.length];
    calloutIndexRef.current += 1;

    await Speech.stop();
    setLastCallout(phrase);

    Speech.speak(phrase, {
      rate: 1.2,
      pitch: source === 'trip' ? 1.65 : 1.5,
      volume: 1,
    });
  }, []);

  const registerTrip = useCallback(() => {
    const now = Date.now();
    if (now - lastTripAtRef.current < TRIP_COOLDOWN_MS) {
      return;
    }

    lastTripAtRef.current = now;
    candidateAtRef.current = null;
    setTripCount((count) => count + 1);
    setStatus('Trip detected');
    void playCallout('trip');

    setTimeout(() => {
      setStatus((current) => (current === 'Trip detected' ? 'Monitoring' : current));
    }, 1400);
  }, [playCallout]);

  const processSample = useCallback(
    ({ x, y, z }: { x: number; y: number; z: number }) => {
      const now = Date.now();
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const jerk = Math.abs(magnitude - lastMagnitudeRef.current);
      const profile = DETECTION_PROFILES[sensitivityRef.current];
      const candidateAt = candidateAtRef.current;

      lastMagnitudeRef.current = magnitude;
      setMagnitudeG(magnitude);

      if (candidateAt !== null) {
        const candidateAge = now - candidateAt;

        if (
          candidateAge <= profile.windowMs &&
          magnitude >= profile.impactG &&
          jerk >= profile.impactJerkG
        ) {
          registerTrip();
          return;
        }

        if (candidateAge > profile.windowMs) {
          candidateAtRef.current = null;
        }
      }

      const lowAcceleration = magnitude <= profile.freeFallG;
      const destabilizingDrop =
        magnitude < 1.25 && jerk >= profile.destabilizingJerkG;

      if (lowAcceleration || destabilizingDrop) {
        candidateAtRef.current = now;
      }
    },
    [registerTrip],
  );

  const stopMonitoring = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    candidateAtRef.current = null;
    lastMagnitudeRef.current = 1;
    setMonitoring(false);
    setStatus('Paused');
  }, []);

  const startMonitoring = useCallback(async () => {
    try {
      const available = await Accelerometer.isAvailableAsync();
      setSensorAvailable(available);

      if (!available) {
        setStatus('Accelerometer unavailable');
        Alert.alert(
          'Accelerometer unavailable',
          'Use a physical Android or iPhone device with an accelerometer.',
        );
        return;
      }

      const permission = await Accelerometer.requestPermissionsAsync();
      if (!permission.granted) {
        setStatus('Motion permission denied');
        Alert.alert(
          'Motion permission needed',
          'Enable motion access in system settings so the app can detect trips.',
        );
        return;
      }

      subscriptionRef.current?.remove();
      candidateAtRef.current = null;
      lastMagnitudeRef.current = 1;
      Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
      subscriptionRef.current = Accelerometer.addListener(processSample);
      setMonitoring(true);
      setStatus('Monitoring');
    } catch (error) {
      setMonitoring(false);
      setStatus('Could not start sensor');
      Alert.alert(
        'Sensor error',
        error instanceof Error ? error.message : 'Unable to start the accelerometer.',
      );
    }
  }, [processSample]);

  useEffect(() => {
    return () => {
      subscriptionRef.current?.remove();
      void Speech.stop();
    };
  }, []);

  const handleMonitoringChange = (enabled: boolean) => {
    if (enabled) {
      void startMonitoring();
    } else {
      stopMonitoring();
    }
  };

  const handleTestCallout = () => {
    setStatus('Testing callout');
    void playCallout('test');
    setTimeout(() => {
      setStatus(monitoring ? 'Monitoring' : 'Ready');
    }, 1200);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>HIKING SAFETY EXPERIMENT</Text>
          <Text style={styles.title}>Trail Callout</Text>
          <Text style={styles.subtitle}>
            Detects a stumble-and-impact pattern and answers with a playful vocal callout.
          </Text>
        </View>

        <View style={styles.statusCard}>
          <View>
            <Text style={styles.label}>Detector</Text>
            <Text style={styles.status}>{status}</Text>
          </View>
          <Switch
            value={monitoring}
            onValueChange={handleMonitoringChange}
            accessibilityLabel="Toggle trip detection"
            trackColor={{ false: '#415044', true: '#8dd694' }}
            thumbColor="#f7fff7"
          />
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{tripCount}</Text>
            <Text style={styles.metricLabel}>Trips detected</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{magnitudeG.toFixed(2)}g</Text>
            <Text style={styles.metricLabel}>Acceleration</Text>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Sensitivity</Text>
          <Text style={styles.sectionDescription}>
            Start with Balanced. Raise sensitivity only after testing with your phone secured in its hiking position.
          </Text>

          <View style={styles.segmentedControl}>
            {(Object.keys(DETECTION_PROFILES) as Sensitivity[]).map((level) => {
              const selected = sensitivity === level;
              return (
                <Pressable
                  key={level}
                  onPress={() => setSensitivity(level)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.segment, selected && styles.segmentSelected]}
                >
                  <Text style={[styles.segmentTitle, selected && styles.segmentTextSelected]}>
                    {level[0].toUpperCase() + level.slice(1)}
                  </Text>
                  <Text style={[styles.segmentCaption, selected && styles.segmentTextSelected]}>
                    {DETECTION_PROFILES[level].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Last callout</Text>
          <Text style={styles.callout}>{lastCallout}</Text>
          <Pressable
            onPress={handleTestCallout}
            style={({ pressed }) => [styles.testButton, pressed && styles.buttonPressed]}
            accessibilityRole="button"
          >
            <Text style={styles.testButtonText}>Test sound</Text>
          </Pressable>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Important</Text>
          <Text style={styles.noticeText}>
            This is a novelty prototype, not a fall detector or emergency device. Accelerometer-only detection can miss real incidents or trigger during jumps, running, or phone drops.
          </Text>
        </View>

        <Text style={styles.footer}>
          Sensor: {sensorAvailable === null ? 'not checked' : sensorAvailable ? 'available' : 'unavailable'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#102116',
  },
  container: {
    padding: 20,
    paddingBottom: 40,
    gap: 16,
  },
  hero: {
    paddingVertical: 18,
  },
  eyebrow: {
    color: '#9ed3a5',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  title: {
    color: '#f5fff5',
    fontSize: 42,
    fontWeight: '900',
    marginTop: 6,
  },
  subtitle: {
    color: '#c4d9c8',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
    maxWidth: 560,
  },
  statusCard: {
    alignItems: 'center',
    backgroundColor: '#1b3423',
    borderColor: '#315b3d',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
  },
  label: {
    color: '#9fb9a4',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  status: {
    color: '#f4fff5',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    backgroundColor: '#e6f2e5',
    borderRadius: 20,
    flex: 1,
    minHeight: 120,
    padding: 18,
  },
  metricValue: {
    color: '#17351f',
    fontSize: 30,
    fontWeight: '900',
  },
  metricLabel: {
    color: '#48664e',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  panel: {
    backgroundColor: '#17301f',
    borderRadius: 22,
    padding: 20,
  },
  sectionTitle: {
    color: '#f5fff5',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionDescription: {
    color: '#b7cdbb',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },
  segmentedControl: {
    gap: 8,
    marginTop: 16,
  },
  segment: {
    borderColor: '#3b5941',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  segmentSelected: {
    backgroundColor: '#a9e5ae',
    borderColor: '#a9e5ae',
  },
  segmentTitle: {
    color: '#eef9ef',
    fontSize: 15,
    fontWeight: '800',
  },
  segmentCaption: {
    color: '#9db7a2',
    fontSize: 12,
    marginTop: 2,
  },
  segmentTextSelected: {
    color: '#15351d',
  },
  callout: {
    color: '#d8ffda',
    fontSize: 36,
    fontWeight: '900',
    marginTop: 12,
  },
  testButton: {
    alignItems: 'center',
    backgroundColor: '#f3c969',
    borderRadius: 14,
    marginTop: 16,
    paddingVertical: 14,
  },
  buttonPressed: {
    opacity: 0.78,
  },
  testButtonText: {
    color: '#392b0b',
    fontSize: 16,
    fontWeight: '900',
  },
  notice: {
    backgroundColor: '#392f18',
    borderColor: '#6c5823',
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  noticeTitle: {
    color: '#ffe9a8',
    fontSize: 15,
    fontWeight: '900',
  },
  noticeText: {
    color: '#e5d8ad',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  footer: {
    color: '#78937e',
    fontSize: 12,
    textAlign: 'center',
  },
});
