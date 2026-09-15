import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Eye, Mic, MicOff, MonitorUp, PhoneOff, Radio, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const TURN_URL = import.meta.env.VITE_TURN_URL as string | undefined;
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME as string | undefined;
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
const ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    ...(TURN_URL && TURN_USERNAME && TURN_CREDENTIAL
      ? [{ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]
      : []),
  ],
};

type Presence = { name: string; joined: boolean; sharing: boolean; camOn: boolean; micOn: boolean };
type Peer = { id: string; name: string; stream: MediaStream; hasVideo: boolean; sharing: boolean };

export function VoiceRoom({ channelId, channelName, userId, userName }: {
  channelId: string;
  channelName: string;
  userId: string;
  userName: string;
}) {
  const [ready, setReady] = useState(false);
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [liveHosts, setLiveHosts] = useState<string[]>([]);
  const local = useRef(new MediaStream());
  const localVideo = useRef<HTMLVideoElement>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const remoteStreams = useRef(new Map<string, MediaStream>());
  const queuedIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const rt = useRef<RealtimeChannel | null>(null);
  const presence = useRef<Presence>({ name: userName, joined: false, sharing: false, camOn: false, micOn: false });

  const upsert = (id: string, patch: Partial<Peer>) => setPeers((old) => {
    const found = old.find((p) => p.id === id);
    if (found) return old.map((p) => p.id === id ? { ...p, ...patch } : p);
    const stream = remoteStreams.current.get(id) ?? patch.stream ?? new MediaStream();
    remoteStreams.current.set(id, stream);
    return [...old, { id, name: "Membro", stream, hasVideo: false, sharing: false, ...patch }];
  });

  function track(patch: Partial<Presence>) {
    presence.current = { ...presence.current, ...patch, name: userName };
    if (rt.current) void rt.current.track(presence.current);
  }

  function sender(pc: RTCPeerConnection, kind: "audio" | "video") {
    return pc.getTransceivers().find((t) => t.receiver.track.kind === kind)?.sender;
  }

  function replaceAll(kind: "audio" | "video", media: MediaStreamTrack | null) {
    pcs.current.forEach((pc) => void sender(pc, kind)?.replaceTrack(media));
  }

  async function flushIce(id: string, pc: RTCPeerConnection) {
    const list = queuedIce.current.get(id) ?? [];
    queuedIce.current.delete(id);
    for (const candidate of list) {
      try { await pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
    }
  }

  function peer(id: string, name: string, initiator: boolean) {
    const old = pcs.current.get(id);
    if (old) { upsert(id, { name }); return old; }
    const pc = new RTCPeerConnection(ICE);
    pcs.current.set(id, pc);
    const remote = new MediaStream();
    remoteStreams.current.set(id, remote);
    upsert(id, { name, stream: remote });

    pc.addTransceiver("audio", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });
    void sender(pc, "audio")?.replaceTrack(local.current.getAudioTracks()[0] ?? null);
    void sender(pc, "video")?.replaceTrack(local.current.getVideoTracks()[0] ?? null);

    pc.ontrack = (event) => {
      if (!remote.getTracks().some((t) => t.id === event.track.id)) remote.addTrack(event.track);
      upsert(id, { stream: remote });
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) void rt.current?.send({
        type: "broadcast", event: "signal",
        payload: { to: id, from: userId, name: userName, candidate: event.candidate.toJSON() },
      });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        pc.close(); pcs.current.delete(id); remoteStreams.current.delete(id);
        setPeers((list) => list.filter((p) => p.id !== id));
      }
    };
    if (initiator) pc.onnegotiationneeded = async () => {
      if (pc.signalingState !== "stable") return;
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await rt.current?.send({ type: "broadcast", event: "signal", payload: { to: id, from: userId, name: userName, sdp: pc.localDescription } });
      } catch { /* presence sync retries */ }
    };
    return pc;
  }

  function sync(channel: RealtimeChannel) {
    const state = channel.presenceState<Presence>();
    const activeIds: string[] = [];
    const hosts: string[] = [];
    Object.entries(state).forEach(([id, values]) => {
      if (id === userId) return;
      const meta = values?.[0] as Presence | undefined;
      if (!meta) return;
      if (meta.sharing) hosts.push(meta.name ?? "Membro");
      if (!meta.joined) return;
      activeIds.push(id);
      upsert(id, { name: meta.name ?? "Membro", hasVideo: meta.camOn || meta.sharing, sharing: meta.sharing });
      if (presence.current.joined) peer(id, meta.name ?? "Membro", userId < id);
    });
    setLiveHosts(hosts);
    pcs.current.forEach((pc, id) => {
      if (!presence.current.joined || !activeIds.includes(id)) {
        pc.close(); pcs.current.delete(id); remoteStreams.current.delete(id);
        setPeers((list) => list.filter((p) => p.id !== id));
      }
    });
  }

  useEffect(() => {
    const channel = supabase.channel(`voice-${channelId}`, { config: { presence: { key: userId } } });
    rt.current = channel;
    channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      if (payload.to !== userId || !presence.current.joined) return;
      const from = payload.from as string;
      const pc = peer(from, payload.name ?? "Membro", userId < from);
      try {
        if (payload.sdp) {
          await pc.setRemoteDescription(payload.sdp);
          await flushIce(from, pc);
          if (payload.sdp.type === "offer") {
            await pc.setLocalDescription(await pc.createAnswer());
            await channel.send({ type: "broadcast", event: "signal", payload: { to: from, from: userId, name: userName, sdp: pc.localDescription } });
          }
        } else if (payload.candidate) {
          if (pc.remoteDescription) await pc.addIceCandidate(payload.candidate);
          else queuedIce.current.set(from, [...(queuedIce.current.get(from) ?? []), payload.candidate]);
        }
      } catch { /* tolerate out-of-order signalling */ }
    });
    channel.on("presence", { event: "sync" }, () => sync(channel));
    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") { setReady(true); await channel.track(presence.current); sync(channel); }
    });
    return () => {
      local.current.getTracks().forEach((t) => t.stop());
      pcs.current.forEach((pc) => pc.close()); pcs.current.clear();
      void supabase.removeChannel(channel); rt.current = null;
    };
  }, [channelId, userId, userName]);

  async function enter(withMic: boolean) {
    try {
      if (withMic) {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audio = media.getAudioTracks()[0];
        if (audio) { local.current.addTrack(audio); setMicOn(true); }
      }
      presence.current.joined = true;
      setJoined(true); track({ joined: true, micOn: withMic });
      if (rt.current) sync(rt.current);
    } catch { toast.error("Não consegui acessar seu microfone."); }
  }

  async function toggleMic() {
    const audio = local.current.getAudioTracks()[0];
    if (audio) { audio.enabled = !audio.enabled; setMicOn(audio.enabled); track({ micOn: audio.enabled }); return; }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = media.getAudioTracks()[0]; if (!next) return;
      local.current.addTrack(next); replaceAll("audio", next); setMicOn(true); track({ micOn: true });
    } catch { toast.error("Não consegui acessar seu microfone."); }
  }

  function stopVideo() {
    local.current.getVideoTracks().forEach((t) => { t.stop(); local.current.removeTrack(t); });
    replaceAll("video", null); setCamOn(false); setSharing(false); track({ camOn: false, sharing: false });
    if (localVideo.current) localVideo.current.srcObject = local.current;
  }

  async function startVideo(screen: boolean) {
    try {
      const media = screen ? await navigator.mediaDevices.getDisplayMedia({ video: true }) : await navigator.mediaDevices.getUserMedia({ video: true });
      const next = media.getVideoTracks()[0]; if (!next) return;
      local.current.getVideoTracks().forEach((t) => { t.stop(); local.current.removeTrack(t); });
      local.current.addTrack(next); replaceAll("video", next); next.onended = stopVideo;
      setCamOn(!screen); setSharing(screen); track({ camOn: !screen, sharing: screen });
      if (localVideo.current) localVideo.current.srcObject = local.current;
    } catch { toast.error(screen ? "Transmissão de tela cancelada." : "Não consegui acessar sua câmera."); }
  }

  function leave() {
    local.current.getTracks().forEach((t) => t.stop()); local.current = new MediaStream();
    pcs.current.forEach((pc) => pc.close()); pcs.current.clear(); setPeers([]);
    setJoined(false); setMicOn(false); setCamOn(false); setSharing(false);
    presence.current.joined = false; track({ joined: false, micOn: false, camOn: false, sharing: false });
  }

  if (!joined) return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"><Radio className="h-7 w-7 text-primary" /></div>
      <div><h2 className="font-display text-xl font-bold">{channelName}</h2><p className="mt-1 text-sm text-muted-foreground">Call, câmera e transmissão de operações ao vivo.</p></div>
      {liveHosts.length > 0 && <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-left">
        <div className="flex items-center gap-2 text-sm font-bold text-destructive"><Radio className="h-4 w-4 animate-pulse" /> AO VIVO AGORA</div>
        <p className="mt-2 text-sm">{liveHosts.join(", ")} está transmitindo.</p>
        <button disabled={!ready} onClick={() => void enter(false)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Eye className="h-4 w-4" /> Assistir transmissão</button>
      </div>}
      <button disabled={!ready} onClick={() => void enter(true)} className="rounded-lg bg-primary px-6 py-2.5 font-bold text-primary-foreground disabled:opacity-50">Entrar na call</button>
    </div>
  );

  return <div className="flex min-h-0 flex-1 flex-col">
    {sharing && <div className="flex items-center justify-center gap-2 border-b border-destructive/30 bg-destructive/10 py-2 text-xs font-bold text-destructive"><Radio className="h-3.5 w-3.5 animate-pulse" /> VOCÊ ESTÁ AO VIVO</div>}
    <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 md:grid-cols-2 xl:grid-cols-3">
      <Tile name={`${userName} (você)`} stream={local.current} hasVideo={camOn || sharing} sharing={sharing} muted videoRef={localVideo} />
      {peers.map((p) => <Tile key={p.id} name={p.name} stream={p.stream} hasVideo={p.hasVideo} sharing={p.sharing} />)}
    </div>
    <div className="flex items-center justify-center gap-3 border-t border-border bg-sidebar p-4">
      <Ctrl active={micOn} onClick={() => void toggleMic()}>{micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}</Ctrl>
      <Ctrl active={camOn} onClick={() => camOn ? stopVideo() : void startVideo(false)}>{camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}</Ctrl>
      <Ctrl active={sharing} onClick={() => sharing ? stopVideo() : void startVideo(true)}><MonitorUp className="h-5 w-5" /></Ctrl>
      <button onClick={leave} className="rounded-full bg-destructive p-3 text-white"><PhoneOff className="h-5 w-5" /></button>
    </div>
  </div>;
}

function Ctrl({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={`rounded-full p-3 ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>{children}</button>;
}

function Tile({ name, stream, hasVideo, sharing, muted, videoRef }: { name: string; stream: MediaStream; hasVideo: boolean; sharing: boolean; muted?: boolean; videoRef?: RefObject<HTMLVideoElement | null> }) {
  const own = useRef<HTMLVideoElement>(null); const ref = videoRef ?? own;
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream, ref]);
  return <div className={`relative flex aspect-video min-h-48 items-center justify-center overflow-hidden rounded-xl border bg-card ${sharing ? "border-destructive/60" : "border-border"}`}>
    <video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full ${sharing ? "object-contain" : "object-cover"} ${hasVideo ? "" : "hidden"}`} />
    {!hasVideo && <div className="flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-2xl font-bold">{name.charAt(0).toUpperCase()}</div>}
    <span className="absolute bottom-2 left-2 flex items-center gap-2 rounded bg-black/70 px-2 py-1 text-xs text-white">{sharing && <Radio className="h-3 w-3 text-red-400" />}{name}{sharing && <b className="text-red-300">AO VIVO</b>}</span>
  </div>;
}
