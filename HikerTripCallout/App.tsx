import { StatusBar } from 'expo-status-bar';
import { DeviceMotion } from 'expo-sensors';
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
type MotionEventKind = 'trip' | 'slip';
type SensorSubscription = { remove: () => void };
type Vector3 = { x: number; y: number; z: number; timestamp?: number };
type RotationRate = { alpha: number; beta: number; gamma: number; timestamp?: number };
type MotionSample = {
  acceleration: Vector3 | null;
  accelerationIncludingGravity: Vector3;
  interval: number;
  rotationRate: RotationRate | null;
};

type DetectionProfile = {
  label: string;
  hardFreeFallG: number;
  hardImpactG: number;
  hardImpactJerkG: number;
  slipLinearG: number;
  slipJerkG: number;
  slipRotationDps: number;
  slipAngleDeg: number;
  windowMs: number;
};

type MotionCandidate = {
  startedAt: number;
  lowGSeen: boolean;
  impactSeen: boolean;
  accelSeen: boolean;
  jerkSeen: boolean;
  rotationSeen: boolean;
  recovered: boolean;
  counterRotationSeen: boolean;
  angularExcursionDeg: number;
  firstRotationVector: RotationRate | null;
};

const DETECTION_PROFILES: Record<Sensitivity, DetectionProfile> = {
  low: {
    label: 'Fewer false triggers',
    hardFreeFallG: 0.42,
    hardImpactG: 2.75,
    hardImpactJerkG: 1.25,
    slipLinearG: 0.95,
    slipJerkG: 0.62,
    slipRotationDps: 190,
    slipAngleDeg: 30,
    windowMs: 850,
  },
  medium: {
    label: 'Balanced',
    hardFreeFallG: 0.58,
    hardImpactG: 2.25,
    hardImpactJerkG: 1,
    slipLinearG: 0.72,
    slipJerkG: 0.45,
    slipRotationDps: 135,
    slipAngleDeg: 22,
    windowMs: 1050,
  },
  high: {
    label: 'Catches smaller slides',
    hardFreeFallG: 0.72,
    hardImpactG: 1.9,
    hardImpactJerkG: 0.78,
    slipLinearG: 0.52,
    slipJerkG: 0.32,
    slipRotationDps: 95,
    slipAngleDeg: 15,
    windowMs: 1250,
  },
};

const GRAVITY = DeviceMotion.Gravity || 9.80665;
const SENSOR_INTERVAL_MS = 40;
const EVENT_COOLDOWN_MS = 3200;
const ARMING_DELAY_MS = 1400;
const MIN_SLIP_DURATION_MS = 160;

const magnitude = ({ x, y, z }: Vector3) => Math.sqrt(x * x + y * y + z * z);
const rotationMagnitude = ({ alpha, beta, gamma }: RotationRate) =>
  Math.sqrt(alpha * alpha + beta * beta + gamma * gamma);
const rotationDot = (a: RotationRate, b: RotationRate) =>
  a.alpha * b.alpha + a.beta * b.beta + a.gamma * b.gamma;
const startCandidate = (now: number, rotationRate: RotationRate | null): MotionCandidate => ({
  startedAt: now,
  lowGSeen: false,
  impactSeen: false,
  accelSeen: false,
  jerkSeen: false,
  rotationSeen: false,
  recovered: false,
  counterRotationSeen: false,
  angularExcursionDeg: 0,
  firstRotationVector: rotationRate,
});

export default function App() {
  const [monitoring, setMonitoring] = useState(false);
  const [sensorAvailable, setSensorAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState('Ready');
  const [tripCount, setTripCount] = useState(0);
  const [slipCount, setSlipCount] = useState(0);
  const [lastEvent, setLastEvent] = useState('—');
  const [lastCallout, setLastCallout] = useState('—');
  const [totalG, setTotalG] = useState(1);
  const [linearG, setLinearG] = useState(0);
  const [rotationDps, setRotationDps] = useState(0);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');

  const subscriptionRef = useRef<SensorSubscription | null>(null);
  const candidateRef = useRef<MotionCandidate | null>(null);
  const lastTotalGRef = useRef(1);
  const lastLinearGRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const lastEventAtRef = useRef(0);
  const armedAtRef = useRef(0);
  const calloutIndexRef = useRef(0);
  const sensitivityRef = useRef<Sensitivity>('medium');

  useEffect(() => {
    sensitivityRef.current = sensitivity;
    candidateRef.current = null;
  }, [sensitivity]);

  const playCallout = useCallback(async (source: 'event' | 'test') => {
    const phrases = ['Hee hee!', 'Hoo hoo!'] as const;
    const phrase = phrases[calloutIndexRef.current % phrases.length] ?? phrases[0];
    calloutIndexRef.current += 1;

    await Speech.stop();
    setLastCallout(phrase);

    Speech.speak(phrase, {
      rate: 1.2,
      pitch: source === 'event' ? 1.65 : 1.5,
      volume: 1,
    });
  }, []);

  const registerEvent = useCallback(
    (kind: MotionEventKind) => {
      const now = Date.now();
      if (now - lastEventAtRef.current < EVENT_COOLDOWN_MS) {
        return;
      }

      lastEventAtRef.current = now;
      candidateRef.current = null;

      if (kind === 'trip') {
        setTripCount((count) => count + 1);
        setLastEvent('Hard trip');
        setStatus('Hard trip detected');
      } else {
        setSlipCount((count) => count + 1);
        setLastEvent('Slip / slide');
        setStatus('Slip detected');
      }

      void playCallout('event');

      setTimeout(() => {
        setStatus((current) =>
          current === 'Hard trip detected' || current === 'Slip detected'
            ? 'Monitoring'
            : current,
        );
      }, 1500);
    },
    [playCallout],
  );

  const processSample = useCallback(
    (sample: MotionSample) => {
      const now = Date.now();
      const profile = DETECTION_PROFILES[sensitivityRef.current];
      const measuredTotalG = magnitude(sample.accelerationIncludingGravity) / GRAVITY;
      const measuredLinearG = sample.acceleration
        ? magnitude(sample.acceleration) / GRAVITY
        : Math.abs(measuredTotalG - 1);
      const measuredRotationDps = sample.rotationRate ? rotationMagnitude(sample.rotationRate) : 0;
      const totalJerkG = Math.abs(measuredTotalG - lastTotalGRef.current);
      const linearJerkG = Math.abs(measuredLinearG - lastLinearGRef.current);
      const strongestJerkG = Math.max(totalJerkG, linearJerkG);
      const elapsedMs = lastSampleAtRef.current
        ? Math.min(100, Math.max(10, now - lastSampleAtRef.current))
        : SENSOR_INTERVAL_MS;

      lastTotalGRef.current = measuredTotalG;
      lastLinearGRef.current = measuredLinearG;
      lastSampleAtRef.current = now;
      setTotalG(measuredTotalG);
      setLinearG(measuredLinearG);
      setRotationDps(measuredRotationDps);

      if (now < armedAtRef.current) {
        return;
      }

      const lowG = measuredTotalG <= profile.hardFreeFallG;
      const directImpact =
        measuredTotalG >= profile.hardImpactG && totalJerkG >= profile.hardImpactJerkG;
      const slipAcceleration = measuredLinearG >= profile.slipLinearG;
      const slipJerk = strongestJerkG >= profile.slipJerkG;
      const fastRotation = measuredRotationDps >= profile.slipRotationDps;
      const possibleSlip =
        (slipAcceleration && measuredRotationDps >= profile.slipRotationDps * 0.6) ||
        (fastRotation && strongestJerkG >= profile.slipJerkG * 0.65);

      if (!candidateRef.current && (lowG || directImpact || possibleSlip)) {
        candidateRef.current = startCandidate(now, sample.rotationRate);
      }

      const candidate = candidateRef.current;
      if (!candidate) {
        return;
      }

      const ageMs = now - candidate.startedAt;
      candidate.lowGSeen ||= lowG;
      candidate.impactSeen ||= directImpact;
      candidate.accelSeen ||= slipAcceleration;
      candidate.jerkSeen ||= slipJerk;
      candidate.rotationSeen ||= fastRotation;
      candidate.angularExcursionDeg += measuredRotationDps * (elapsedMs / 1000);

      if (!candidate.firstRotationVector && sample.rotationRate && measuredRotationDps > 1) {
        candidate.firstRotationVector = sample.rotationRate;
      }

      if (
        candidate.firstRotationVector &&
        sample.rotationRate &&
        rotationMagnitude(candidate.firstRotationVector) >= profile.slipRotationDps * 0.55 &&
        measuredRotationDps >= profile.slipRotationDps * 0.45 &&
        rotationDot(candidate.firstRotationVector, sample.rotationRate) < 0
      ) {
        candidate.counterRotationSeen = true;
      }

      if (
        ageMs >= MIN_SLIP_DURATION_MS &&
        candidate.rotationSeen &&
        measuredRotationDps <= profile.slipRotationDps * 0.42
      ) {
        candidate.recovered = true;
      }

      const hardTripConfirmed =
        candidate.impactSeen &&
        (candidate.lowGSeen || candidate.rotationSeen || (candidate.accelSeen && candidate.jerkSeen));

      if (hardTripConfirmed) {
        registerEvent('trip');
        return;
      }

      const slipConfirmed =
        candidate.accelSeen &&
        candidate.jerkSeen &&
        candidate.rotationSeen &&
        (candidate.angularExcursionDeg >= profile.slipAngleDeg ||
          candidate.counterRotationSeen) &&
        (candidate.recovered || candidate.counterRotationSeen);

      if (ageMs >= MIN_SLIP_DURATION_MS && slipConfirmed) {
        registerEvent('slip');
        return;
      }

      if (ageMs > profile.windowMs) {
        const strongUnrecoveredSlip =
          candidate.accelSeen &&
          candidate.jerkSeen &&
          candidate.rotationSeen &&
          candidate.angularExcursionDeg >= profile.slipAngleDeg * 1.4;

        if (strongUnrecoveredSlip) {
          registerEvent('slip');
        } else {
          candidateRef.current = null;
        }
      }
    },
    [registerEvent],
  );

  const stopMonitoring = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    candidateRef.current = null;
    lastTotalGRef.current = 1;
    lastLinearGRef.current = 0;
    lastSampleAtRef.current = 0;
    setMonitoring(false);
    setStatus('Paused');
  }, []);

  const startMonitoring = useCallback(async () => {
    try {
      const available = await DeviceMotion.isAvailableAsync();
      setSensorAvailable(available);

      if (!available) {
        setStatus('Motion sensors unavailable');
        Alert.alert(
          'Motion sensors unavailable',
          'Use a physical Android or iPhone with motion and rotation sensors.',
        );
        return;
      }

      const permission = await DeviceMotion.requestPermissionsAsync();
      if (!permission.granted) {
        setStatus('Motion permission denied');
        Alert.alert(
          'Motion permission needed',
          'Enable motion access in system settings so the app can detect trips and slides.',
        );
        return;
      }

      subscriptionRef.current?.remove();
      candidateRef.current = null;
      lastTotalGRef.current = 1;
      lastLinearGRef.current = 0;
      lastSampleAtRef.current = 0;
      armedAtRef.current = Date.now() + ARMING_DELAY_MS;
      DeviceMotion.setUpdateInterval(SENSOR_INTERVAL_MS);
      subscriptionRef.current = DeviceMotion.addListener((sample) => processSample(sample));
      setMonitoring(true);
      setStatus('Calibrating…');

      setTimeout(() => {
        setStatus((current) => (current === 'Calibrating…' ? 'Monitoring' : current));
      }, ARMING_DELAY_MS);
    } catch (error) {
      setMonitoring(false);
      setStatus('Could not start sensors');
      Alert.alert(
        'Sensor error',
        error instanceof Error ? error.message : 'Unable to start device motion sensors.',
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
          <Text style={styles.eyebrow}>HIKING MOTION EXPERIMENT</Text>
          <Text style={styles.title}>Trail Callout</Text>
          <Text style={styles.subtitle}>
            Uses fused acceleration and rotation data to catch hard trips plus smaller slips and slides.
          </Text>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusCopy}>
            <Text style={styles.label}>Detector</Text>
            <Text style={styles.status}>{status}</Text>
          </View>
          <Switch
            value={monitoring}
            onValueChange={handleMonitoringChange}
            accessibilityLabel="Toggle trip and slip detection"
            trackColor={{ false: '#415044', true: '#8dd694' }}
            thumbColor="#f7fff7"
          />
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{tripCount}</Text>
            <Text style={styles.metricLabel}>Hard trips</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{slipCount}</Text>
            <Text style={styles.metricLabel}>Slips / slides</Text>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Live motion</Text>
          <View style={styles.liveRow}>
            <View style={styles.liveMetric}>
              <Text style={styles.liveValue}>{totalG.toFixed(2)}g</Text>
              <Text style={styles.liveLabel}>Total force</Text>
            </View>
            <View style={styles.liveMetric}>
              <Text style={styles.liveValue}>{linearG.toFixed(2)}g</Text>
              <Text style={styles.liveLabel}>Body motion</Text>
            </View>
            <View style={styles.liveMetric}>
              <Text style={styles.liveValue}>{Math.round(rotationDps)}°/s</Text>
              <Text style={styles.liveLabel}>Rotation</Text>
            </View>
          </View>
          <Text style={styles.lastEvent}>Last event: {lastEvent}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Sensitivity</Text>
          <Text style={styles.sectionDescription}>
            Start with Balanced. High is intended for small slides, but it will also react more often to running, scrambling, and a loose phone.
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
          <Text style={styles.noticeTitle}>Secure the phone</Text>
          <Text style={styles.noticeText}>
            Keep it snug against your body in the same pocket or mount each time. A phone bouncing freely in a backpack can look exactly like a slip.
          </Text>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Important</Text>
          <Text style={styles.noticeText}>
            This is a novelty prototype, not a fall detector or emergency device. Phone-only heuristics can miss real incidents and can trigger during jumps, running, climbing, or deliberate phone movement.
          </Text>
        </View>

        <Text style={styles.footer}>
          Device motion: {sensorAvailable === null ? 'not checked' : sensorAvailable ? 'available' : 'unavailable'}
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
  statusCopy: {
    flex: 1,
    paddingRight: 16,
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
    minHeight: 112,
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
  liveRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  liveMetric: {
    backgroundColor: '#102619',
    borderRadius: 14,
    flex: 1,
    padding: 12,
  },
  liveValue: {
    color: '#d9ffdc',
    fontSize: 17,
    fontWeight: '900',
  },
  liveLabel: {
    color: '#91ae96',
    fontSize: 11,
    marginTop: 4,
  },
  lastEvent: {
    color: '#bed0c1',
    fontSize: 13,
    marginTop: 14,
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
