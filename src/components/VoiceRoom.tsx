import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
};

type Peer = { id: string; name: string; stream: MediaStream | null };

export function VoiceRoom({
  channelId,
  channelName,
  userId,
  userName,
}: {
  channelId: string;
  channelName: string;
  userId: string;
  userName: string;
}) {
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);

  const localStream = useRef<MediaStream | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const rt = useRef<RealtimeChannel | null>(null);

  const upsertPeer = (id: string, patch: Partial<Peer>) =>
    setPeers((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found)
        return prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
      return [...prev, { id, name: "Membro", stream: null, ...patch }];
    });

  function cleanup() {
    pcs.current.forEach((pc) => pc.close());
    pcs.current.clear();
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    if (rt.current) supabase.removeChannel(rt.current);
    rt.current = null;
    setPeers([]);
    setSharing(false);
    setCamOn(false);
    setJoined(false);
  }

  useEffect(() => cleanup, [channelId]);

  function createPeer(remoteId: string, remoteName: string, polite: boolean) {
    const existing = pcs.current.get(remoteId);
    if (existing) return existing;
    const pc = new RTCPeerConnection(ICE);
    pcs.current.set(remoteId, pc);
    upsertPeer(remoteId, { name: remoteName });

    localStream.current
      ?.getTracks()
      .forEach((t) => pc.addTrack(t, localStream.current!));

    pc.ontrack = (e) => upsertPeer(remoteId, { stream: e.streams[0] ?? null });
    pc.onicecandidate = (e) => {
      if (e.candidate)
        rt.current?.send({
          type: "broadcast",
          event: "signal",
          payload: {
            to: remoteId,
            from: userId,
            name: userName,
            candidate: e.candidate.toJSON(),
          },
        });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        pc.close();
        pcs.current.delete(remoteId);
        setPeers((prev) => prev.filter((p) => p.id !== remoteId));
      }
    };

    if (!polite) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          rt.current?.send({
            type: "broadcast",
            event: "signal",
            payload: {
              to: remoteId,
              from: userId,
              name: userName,
              sdp: pc.localDescription,
            },
          });
        } catch {
          /* ignore */
        }
      };
    }
    return pc;
  }

  async function join() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStream.current = stream;
      setMicOn(true);
      setJoined(true);

      const ch = supabase.channel(`voice-${channelId}`, {
        config: { presence: { key: userId } },
      });
      rt.current = ch;

      ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
        if (payload.to !== userId) return;
        const from = payload.from as string;
        const polite = userId > from;
        const pc = createPeer(from, payload.name ?? "Membro", polite);
        try {
          if (payload.sdp) {
            await pc.setRemoteDescription(payload.sdp);
            if (payload.sdp.type === "offer") {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              ch.send({
                type: "broadcast",
                event: "signal",
                payload: {
                  to: from,
                  from: userId,
                  name: userName,
                  sdp: pc.localDescription,
                },
              });
            }
          } else if (payload.candidate) {
            await pc.addIceCandidate(payload.candidate);
          }
        } catch {
          /* ignore glare */
        }
      });

      ch.on("presence", { event: "sync" }, () => {
        const state = ch.presenceState<{ name: string }>();
        const ids = Object.keys(state).filter((id) => id !== userId);
        ids.forEach((id) => {
          const name = state[id]?.[0]?.name ?? "Membro";
          // lower id initiates the offer
          createPeer(id, name, userId > id);
        });
        pcs.current.forEach((pc, id) => {
          if (!ids.includes(id)) {
            pc.close();
            pcs.current.delete(id);
            setPeers((prev) => prev.filter((p) => p.id !== id));
          }
        });
      });

      ch.subscribe(async (status) => {
        if (status === "SUBSCRIBED")
          await ch.track({ name: userName, at: Date.now() });
      });
    } catch {
      toast.error("Não consegui acessar seu microfone. Libere a permissão.");
    }
  }

  function toggleMic() {
    const track = localStream.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  function replaceVideoTrack(track: MediaStreamTrack | null) {
    pcs.current.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (track) {
        if (sender) sender.replaceTrack(track);
        else pc.addTrack(track, localStream.current!);
      } else if (sender) {
        pc.removeTrack(sender);
      }
    });
  }

  function stopVideo() {
    const old = localStream.current?.getVideoTracks()[0];
    if (old) {
      old.stop();
      localStream.current?.removeTrack(old);
    }
    replaceVideoTrack(null);
    if (localVideo.current) localVideo.current.srcObject = localStream.current;
    setCamOn(false);
    setSharing(false);
  }

  async function startVideo(screen: boolean) {
    try {
      const media = screen
        ? await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          })
        : await navigator.mediaDevices.getUserMedia({ video: true });
      const track = media.getVideoTracks()[0];
      if (!track) return;
      const old = localStream.current?.getVideoTracks()[0];
      if (old) {
        old.stop();
        localStream.current?.removeTrack(old);
      }
      localStream.current?.addTrack(track);
      replaceVideoTrack(track);
      track.onended = () => stopVideo();
      if (localVideo.current)
        localVideo.current.srcObject = localStream.current;
      setCamOn(!screen);
      setSharing(screen);
    } catch {
      toast.error(
        screen
          ? "Transmissão de tela cancelada."
          : "Não consegui acessar sua câmera.",
      );
    }
  }

  const showingLocalVideo = camOn || sharing;
  const tiles = useMemo(() => peers, [peers]);

  if (!joined) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <Video className="h-10 w-10 text-primary" />
        <p className="font-display text-lg">Sala de voz {channelName}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Entre na call para conversar, ligar a câmera e transmitir sua tela.
        </p>
        <button
          onClick={join}
          className="rounded-md bg-primary px-6 py-2.5 font-semibold text-primary-foreground"
        >
          Entrar na call
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          name={`${userName} (você)`}
          muted
          videoRef={localVideo}
          stream={localStream.current}
          hasVideo={showingLocalVideo}
        />
        {tiles.map((p) => (
          <Tile
            key={p.id}
            name={p.name}
            stream={p.stream}
            hasVideo={!!p.stream?.getVideoTracks().length}
          />
        ))}
      </div>
      <div className="flex items-center justify-center gap-3 border-t border-border p-4">
        <Ctrl active={micOn} onClick={toggleMic} label="Microfone">
          {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </Ctrl>
        <Ctrl
          active={camOn}
          onClick={() => (camOn ? stopVideo() : startVideo(false))}
          label="Câmera"
        >
          {camOn ? (
            <Video className="h-5 w-5" />
          ) : (
            <VideoOff className="h-5 w-5" />
          )}
        </Ctrl>
        <Ctrl
          active={sharing}
          onClick={() => (sharing ? stopVideo() : startVideo(true))}
          label="Transmitir tela"
        >
          <MonitorUp className="h-5 w-5" />
        </Ctrl>
        <button
          onClick={cleanup}
          title="Sair da call"
          className="rounded-full bg-destructive p-3 text-destructive-foreground"
        >
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function Ctrl({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`rounded-full p-3 transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-secondary text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Tile({
  name,
  stream,
  hasVideo,
  muted,
  videoRef,
}: {
  name: string;
  stream: MediaStream | null;
  hasVideo: boolean;
  muted?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? ownRef;

  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream, ref]);

  return (
    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-border bg-card">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${hasVideo ? "" : "hidden"}`}
      />
      {!hasVideo && (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-xl font-semibold">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {name}
      </span>
    </div>
  );
}
