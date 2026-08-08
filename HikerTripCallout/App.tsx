import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { DeviceMotion } from 'expo-sensors';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

type Sensitivity = 'low' | 'medium' | 'high';
type Wear = 'pocket' | 'belt' | 'backpack';
type Kind = 'trip' | 'slip';
type Verdict = 'unreviewed' | 'real' | 'false';
type V3 = { x: number; y: number; z: number };
type RR = { alpha: number; beta: number; gamma: number };
type Sample = { acceleration: V3 | null; accelerationIncludingGravity: V3; rotationRate: RR | null; interval: number };
type Candidate = {
  start: number; low: boolean; impact: boolean; accel: boolean; jerk: boolean; rotate: boolean;
  recover: boolean; counter: boolean; angle: number; firstRot: RR | null;
  peakTotal: number; peakLinear: number; peakRot: number; peakJerk: number;
};
type Event = {
  id: string; kind: Kind; time: number; confidence: number; total: number; linear: number;
  rotation: number; angle: number; sensitivity: Sensitivity; wear: Wear; verdict: Verdict; simulated?: boolean;
};

type Profile = {
  label: string; free: number; impact: number; impactJerk: number; linear: number;
  jerk: number; rotation: number; angle: number; window: number;
};

const P: Record<Sensitivity, Profile> = {
  low: { label: 'Fewer false triggers', free: .42, impact: 2.75, impactJerk: 1.25, linear: .95, jerk: .62, rotation: 190, angle: 30, window: 850 },
  medium: { label: 'Balanced', free: .58, impact: 2.25, impactJerk: 1, linear: .72, jerk: .45, rotation: 135, angle: 22, window: 1050 },
  high: { label: 'Catches smaller slides', free: .72, impact: 1.9, impactJerk: .78, linear: .52, jerk: .32, rotation: 95, angle: 15, window: 1250 },
};
const W: Record<Wear, { label: string; factor: number; note: string }> = {
  pocket: { label: 'Snug pocket', factor: 1, note: 'Best general choice.' },
  belt: { label: 'Belt / chest', factor: .9, note: 'Stable mount; slightly more sensitive.' },
  backpack: { label: 'Backpack', factor: 1.25, note: 'Stricter because the bag can bounce.' },
};
const G = DeviceMotion.Gravity || 9.80665;
const SETTINGS = 'trail.settings.v2', EVENTS = 'trail.events.v2', KEEP = 'trail-monitor';
const mag = (v: V3) => Math.hypot(v.x, v.y, v.z);
const rmag = (r: RR) => Math.hypot(r.alpha, r.beta, r.gamma);
const dot = (a: RR, b: RR) => a.alpha*b.alpha + a.beta*b.beta + a.gamma*b.gamma;
const clamp = (n: number) => Math.max(0, Math.min(99, Math.round(n)));
const blank = (now: number, r: RR | null): Candidate => ({ start: now, low:false, impact:false, accel:false, jerk:false, rotate:false, recover:false, counter:false, angle:0, firstRot:r, peakTotal:0, peakLinear:0, peakRot:0, peakJerk:0 });
const time = (t:number) => new Date(t).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });

export default function App() {
  const [monitoring,setMonitoring]=useState(false), [status,setStatus]=useState('Ready');
  const [available,setAvailable]=useState<boolean|null>(null), [sensitivity,setSensitivity]=useState<Sensitivity>('medium');
  const [wear,setWear]=useState<Wear>('pocket'), [sound,setSound]=useState(true), [haptics,setHaptics]=useState(true);
  const [trips,setTrips]=useState(0), [slips,setSlips]=useState(0), [total,setTotal]=useState(1), [linear,setLinear]=useState(0), [rotation,setRotation]=useState(0);
  const [candidateScore,setCandidateScore]=useState(0), [events,setEvents]=useState<Event[]>([]), [callout,setCallout]=useState('—');
  const [calibration,setCalibration]=useState('Not calibrated'), [noiseL,setNoiseL]=useState(0), [noiseR,setNoiseR]=useState(0), [loaded,setLoaded]=useState(false);

  const sub=useRef<{remove:()=>void}|null>(null), c=useRef<Candidate|null>(null), lastT=useRef(1), lastL=useRef(0), lastAt=useRef(0), lastEvent=useRef(0);
  const cal=useRef<{until:number; l:number; r:number}|null>(null), sRef=useRef<Sensitivity>('medium'), wRef=useRef<Wear>('pocket'), soundRef=useRef(true), hRef=useRef(true), noiseLRef=useRef(0), noiseRRef=useRef(0), phrase=useRef(0);
  useEffect(()=>{sRef.current=sensitivity;c.current=null},[sensitivity]);
  useEffect(()=>{wRef.current=wear;c.current=null},[wear]);
  useEffect(()=>{soundRef.current=sound},[sound]); useEffect(()=>{hRef.current=haptics},[haptics]);

  useEffect(()=>{void(async()=>{try{
    const [a,b]=await Promise.all([AsyncStorage.getItem(SETTINGS),AsyncStorage.getItem(EVENTS)]);
    if(a){const x=JSON.parse(a); if(x.sensitivity in P)setSensitivity(x.sensitivity); if(x.wear in W)setWear(x.wear); if(typeof x.sound==='boolean')setSound(x.sound); if(typeof x.haptics==='boolean')setHaptics(x.haptics)}
    if(b){const x=JSON.parse(b); if(Array.isArray(x))setEvents(x.slice(0,30))}
  }finally{setLoaded(true)}})()},[]);
  useEffect(()=>{if(loaded)void AsyncStorage.setItem(SETTINGS,JSON.stringify({sensitivity,wear,sound,haptics}))},[loaded,sensitivity,wear,sound,haptics]);
  useEffect(()=>{if(loaded)void AsyncStorage.setItem(EVENTS,JSON.stringify(events.slice(0,30)))},[loaded,events]);

  const feedback=useCallback(async(kind:Kind,test=false)=>{
    if(hRef.current)void Haptics.notificationAsync(kind==='trip'?Haptics.NotificationFeedbackType.Warning:Haptics.NotificationFeedbackType.Success);
    if(!soundRef.current)return;
    const words=['Hee hee!','Hoo hoo!'] as const, word=words[phrase.current++%2]||words[0]; setCallout(word); await Speech.stop();
    Speech.speak(word,{rate:kind==='trip'?1.15:1.25,pitch:test?1.5:1.65,volume:1});
  },[]);

  const saveEvent=useCallback((kind:Kind,x:Candidate,confidence:number,simulated=false)=>{
    const now=Date.now(); if(!simulated&&now-lastEvent.current<3200)return; lastEvent.current=now;c.current=null;setCandidateScore(0);
    kind==='trip'?setTrips(n=>n+1):setSlips(n=>n+1); setStatus(simulated?`Test ${kind}`:kind==='trip'?'Hard trip detected':'Slip / slide detected');
    const e:Event={id:`${now}-${Math.random()}`,kind,time:now,confidence,total:x.peakTotal,linear:x.peakLinear,rotation:x.peakRot,angle:x.angle,sensitivity:sRef.current,wear:wRef.current,verdict:simulated?'real':'unreviewed',simulated};
    setEvents(v=>[e,...v].slice(0,30)); void feedback(kind,simulated); setTimeout(()=>setStatus(v=>v.includes('detected')||v.startsWith('Test ')?'Monitoring':v),1500);
  },[feedback]);

  const process=useCallback((sample:Sample)=>{
    const now=Date.now(), p=P[sRef.current], wf=W[wRef.current].factor;
    const tg=mag(sample.accelerationIncludingGravity)/G, lg=sample.acceleration?mag(sample.acceleration)/G:Math.abs(tg-1), rr=sample.rotationRate?rmag(sample.rotationRate):0;
    const tj=Math.abs(tg-lastT.current), lj=Math.abs(lg-lastL.current), jerk=Math.max(tj,lj), dt=lastAt.current?Math.min(100,Math.max(10,now-lastAt.current)):40;
    lastT.current=tg;lastL.current=lg;lastAt.current=now;setTotal(tg);setLinear(lg);setRotation(rr);
    if(cal.current){cal.current.l=Math.max(cal.current.l,lg);cal.current.r=Math.max(cal.current.r,rr);if(now<cal.current.until)return;
      const nl=Math.max(.03,cal.current.l),nr=Math.max(4,cal.current.r);noiseLRef.current=nl;noiseRRef.current=nr;setNoiseL(nl);setNoiseR(nr);setCalibration(nl>.28||nr>55?'Noisy fit — secure phone tighter':'Calibrated');setStatus('Monitoring');cal.current=null;return;}
    const lth=Math.max(p.linear*wf,noiseLRef.current*3.2+.12), rth=Math.max(p.rotation*wf,noiseRRef.current*2.8+18);
    const low=tg<=p.free, impact=tg>=p.impact&&tj>=p.impactJerk, acc=lg>=lth, j=jerk>=p.jerk*wf, rot=rr>=rth;
    const possible=(acc&&rr>=rth*.6)||(rot&&jerk>=p.jerk*wf*.65); if(!c.current&&(low||impact||possible))c.current=blank(now,sample.rotationRate);
    const x=c.current;if(!x){if(candidateScore)setCandidateScore(n=>Math.max(0,n-5));return} const age=now-x.start;
    x.low||=low;x.impact||=impact;x.accel||=acc;x.jerk||=j;x.rotate||=rot;x.angle+=rr*(dt/1000);x.peakTotal=Math.max(x.peakTotal,tg);x.peakLinear=Math.max(x.peakLinear,lg);x.peakRot=Math.max(x.peakRot,rr);x.peakJerk=Math.max(x.peakJerk,jerk);
    if(!x.firstRot&&sample.rotationRate&&rr>1)x.firstRot=sample.rotationRate;
    if(x.firstRot&&sample.rotationRate&&rmag(x.firstRot)>=rth*.55&&rr>=rth*.45&&dot(x.firstRot,sample.rotationRate)<0)x.counter=true;
    if(age>=160&&x.rotate&&rr<=rth*.42)x.recover=true;
    const trip=clamp(48+(x.low?18:0)+(x.rotate?10:0)+(x.peakTotal>=p.impact*1.25?12:0)+(x.peakJerk>=p.impactJerk*1.4?12:0));
    const slip=clamp(25+(x.accel?15:0)+(x.jerk?12:0)+(x.rotate?18:0)+(x.angle>=p.angle?12:0)+(x.counter?10:0)+(x.recover?8:0)+(x.peakLinear>=lth*1.35?6:0));
    setCandidateScore(Math.max(trip,slip));
    if(x.impact&&(x.low||x.rotate||(x.accel&&x.jerk))&&trip>=70){saveEvent('trip',{...x},trip);return}
    const slipOK=x.accel&&x.jerk&&x.rotate&&(x.angle>=p.angle||x.counter)&&(x.recover||x.counter);
    if(age>=160&&slipOK&&slip>=72){saveEvent('slip',{...x},slip);return}
    if(age>p.window){if(x.accel&&x.jerk&&x.rotate&&x.angle>=p.angle*1.4&&slip>=78)saveEvent('slip',{...x},slip);else{c.current=null;setCandidateScore(0)}}
  },[candidateScore,saveEvent]);

  const stop=useCallback(()=>{sub.current?.remove();sub.current=null;c.current=null;cal.current=null;lastT.current=1;lastL.current=0;lastAt.current=0;setMonitoring(false);setCandidateScore(0);setStatus('Paused');void deactivateKeepAwake(KEEP)},[]);
  const start=useCallback(async()=>{try{const ok=await DeviceMotion.isAvailableAsync();setAvailable(ok);if(!ok){Alert.alert('Motion sensors unavailable');return}const perm=await DeviceMotion.requestPermissionsAsync();if(!perm.granted){Alert.alert('Motion permission needed');return}
    sub.current?.remove();c.current=null;lastT.current=1;lastL.current=0;lastAt.current=0;noiseLRef.current=0;noiseRRef.current=0;setNoiseL(0);setNoiseR(0);setCalibration('Hold still…');setStatus('Calibrating…');cal.current={until:Date.now()+2500,l:0,r:0};
    DeviceMotion.setUpdateInterval(40);sub.current=DeviceMotion.addListener(sample=>process(sample as Sample));setMonitoring(true);await activateKeepAwakeAsync(KEEP);
  }catch(e){setMonitoring(false);setStatus('Sensor error');Alert.alert('Sensor error',e instanceof Error?e.message:'Unable to start motion sensors')}},[process]);
  useEffect(()=>()=>{sub.current?.remove();void Speech.stop();void deactivateKeepAwake(KEEP)},[]);

  const simulate=(kind:Kind)=>{const x=blank(Date.now(),null);x.peakTotal=kind==='trip'?2.6:1.35;x.peakLinear=kind==='trip'?1.4:.9;x.peakRot=kind==='trip'?180:145;x.angle=kind==='trip'?34:27;saveEvent(kind,x,kind==='trip'?92:84,true)};
  const review=(verdict:'real'|'false')=>setEvents(v=>{const target=v.find(e=>!e.simulated);return target?v.map(e=>e.id===target.id?{...e,verdict}:e):v});
  const lth=Math.max(P[sensitivity].linear*W[wear].factor,noiseL*3.2+.12),rth=Math.max(P[sensitivity].rotation*W[wear].factor,noiseR*2.8+18);
  const latest=events.find(e=>!e.simulated);

  return <SafeAreaView style={st.safe}><StatusBar style="light"/><ScrollView contentContainerStyle={st.page}>
    <View><Text style={st.eyebrow}>HIKING MOTION LAB</Text><Text style={st.title}>Trail Callout</Text><Text style={st.sub}>Fused motion sensing for hard trips, small slips, and balance-recovery events.</Text></View>
    <View style={st.status}><View><Text style={st.label}>DETECTOR</Text><Text style={st.statusText}>{status}</Text><Text style={st.muted}>{calibration}</Text></View><Switch value={monitoring} onValueChange={v=>v?void start():stop()}/></View>
    <View style={st.row}><Card n={trips} label="Hard trips"/><Card n={slips} label="Slips / slides"/></View>
    <Panel title="Live motion"><View style={st.row}><Mini text={`${total.toFixed(2)}g`} label="Total"/><Mini text={`${linear.toFixed(2)}g`} label="Body"/><Mini text={`${Math.round(rotation)}°/s`} label="Rotation"/></View><Text style={st.muted}>Candidate {candidateScore}% · adaptive thresholds {lth.toFixed(2)}g + {Math.round(rth)}°/s</Text></Panel>
    <Panel title="Phone position"><Options values={W} selected={wear} set={v=>setWear(v as Wear)}/></Panel>
    <Panel title="Sensitivity"><Options values={P} selected={sensitivity} set={v=>setSensitivity(v as Sensitivity)}/></Panel>
    <Panel title="Feedback & test"><Toggle label="Callout sound" value={sound} set={setSound}/><Toggle label="Haptic feedback" value={haptics} set={setHaptics}/><Text style={st.muted}>Last callout: {callout}</Text><View style={st.row}><Btn text="Simulate slip" on={()=>simulate('slip')}/><Btn text="Simulate trip" on={()=>simulate('trip')}/></View></Panel>
    <Panel title={`Recent events · ${events.length} saved`}>{events.length?events.slice(0,5).map(e=><View key={e.id} style={st.event}><Text style={st.eventTitle}>{e.kind==='trip'?'Hard trip':'Slip / slide'}{e.simulated?' · TEST':''} · {e.confidence}%</Text><Text style={st.muted}>{time(e.time)} · {e.total.toFixed(2)}g · {e.linear.toFixed(2)}g · {Math.round(e.rotation)}°/s · {e.verdict}</Text></View>):<Text style={st.muted}>No events yet.</Text>}{latest&&<><Text style={st.muted}>Was the latest sensor trigger correct?</Text><View style={st.row}><Btn text="Yes, real" on={()=>review('real')}/><Btn text="False trigger" on={()=>review('false')}/></View></>}</Panel>
    <Panel title="Calibration diagnostics"><Text style={st.muted}>Baseline {noiseL.toFixed(2)}g · {Math.round(noiseR)}°/s. Re-toggle monitoring after changing the phone position.</Text><View style={st.row}><Btn text="Reset counters" on={()=>{setTrips(0);setSlips(0)}}/><Btn text="Clear history" on={()=>Alert.alert('Clear event history?','This removes saved test events.',[{text:'Cancel',style:'cancel'},{text:'Clear',style:'destructive',onPress:()=>setEvents([])}])}/></View></Panel>
    <View style={st.notice}><Text style={st.noticeTitle}>Field-test safely</Text><Text style={st.noticeText}>Do not deliberately fall. Test controlled foot slides and quick balance corrections, plus walking, stairs, jogging, jumping, sitting, and phone handling to expose false positives.</Text></View>
    <Text style={st.footer}>Device motion: {available===null?'not checked':available?'available':'unavailable'} · 25 Hz · foreground test mode</Text>
  </ScrollView></SafeAreaView>;
}

function Panel({title,children}:{title:string;children:React.ReactNode}){return <View style={st.panel}><Text style={st.panelTitle}>{title}</Text>{children}</View>}
function Card({n,label}:{n:number;label:string}){return <View style={st.card}><Text style={st.big}>{n}</Text><Text style={st.cardLabel}>{label}</Text></View>}
function Mini({text,label}:{text:string;label:string}){return <View style={st.mini}><Text style={st.miniText}>{text}</Text><Text style={st.muted}>{label}</Text></View>}
function Btn({text,on}:{text:string;on:()=>void}){return <Pressable onPress={on} style={st.btn}><Text style={st.btnText}>{text}</Text></Pressable>}
function Toggle({label,value,set}:{label:string;value:boolean;set:(v:boolean)=>void}){return <View style={st.toggle}><Text style={st.eventTitle}>{label}</Text><Switch value={value} onValueChange={set}/></View>}
function Options({values,selected,set}:{values:Record<string,{label:string;note?:string}>;selected:string;set:(v:string)=>void}){return <View style={{gap:8,marginTop:12}}>{Object.keys(values).map(k=><Pressable key={k} onPress={()=>set(k)} style={[st.option,k===selected&&st.optionOn]}><Text style={[st.eventTitle,k===selected&&st.optionText]}>{values[k].label}</Text><Text style={[st.muted,k===selected&&st.optionText]}>{values[k].note||''}</Text></Pressable>)}</View>}
const st=StyleSheet.create({safe:{flex:1,backgroundColor:'#102116'},page:{padding:20,paddingBottom:48,gap:16},eyebrow:{color:'#9ed3a5',fontSize:12,fontWeight:'800',letterSpacing:1.5},title:{color:'#f5fff5',fontSize:40,fontWeight:'900'},sub:{color:'#c4d9c8',fontSize:15,lineHeight:22},status:{backgroundColor:'#1b3423',borderRadius:20,padding:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},label:{color:'#9fb9a4',fontSize:12,fontWeight:'800'},statusText:{color:'#fff',fontSize:21,fontWeight:'900'},muted:{color:'#95ad9a',fontSize:12,lineHeight:18,marginTop:5},row:{flexDirection:'row',gap:10,marginTop:12},card:{flex:1,backgroundColor:'#e6f2e5',borderRadius:18,padding:16},big:{fontSize:30,fontWeight:'900',color:'#17351f'},cardLabel:{color:'#48664e',fontWeight:'700'},panel:{backgroundColor:'#17301f',borderRadius:20,padding:18},panelTitle:{color:'#f5fff5',fontSize:19,fontWeight:'900'},mini:{flex:1,backgroundColor:'#102719',borderRadius:12,padding:10},miniText:{color:'#effaf0',fontSize:17,fontWeight:'900'},option:{borderWidth:1,borderColor:'#3b5941',borderRadius:12,padding:11},optionOn:{backgroundColor:'#a9e5ae',borderColor:'#a9e5ae'},optionText:{color:'#15351d'},eventTitle:{color:'#effaf0',fontSize:14,fontWeight:'800'},toggle:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:8},btn:{flex:1,backgroundColor:'#31543a',borderRadius:12,padding:12,alignItems:'center'},btnText:{color:'#effaf0',fontSize:13,fontWeight:'900'},event:{paddingVertical:10,borderBottomWidth:1,borderBottomColor:'#294832'},notice:{backgroundColor:'#392f18',borderRadius:16,padding:16},noticeTitle:{color:'#ffe9a8',fontWeight:'900'},noticeText:{color:'#e5d8ad',fontSize:13,lineHeight:20,marginTop:5},footer:{color:'#78937e',fontSize:11,textAlign:'center'}});
