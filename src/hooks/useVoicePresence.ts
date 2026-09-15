import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type VoicePresenceMember = {
  id: string;
  name: string;
  joined: boolean;
  sharing: boolean;
  camOn: boolean;
  micOn: boolean;
};

export function useVoicePresence(channelIds: string[]) {
  const [presence, setPresence] = useState<Record<string, VoicePresenceMember[]>>({});
  const key = channelIds.join("|");

  useEffect(() => {
    if (!key) {
      setPresence({});
      return;
    }

    const channelIdsFromKey = key.split("|").filter(Boolean);
    const channels = channelIdsFromKey.map((channelId) => {
      const channel = supabase.channel(`voice-${channelId}`);
      const sync = () => {
        const state = channel.presenceState<Omit<VoicePresenceMember, "id">>();
        const members = Object.entries(state)
          .map(([id, values]) => {
            const meta = values?.[0] as Omit<VoicePresenceMember, "id"> | undefined;
            return meta?.joined ? { id, ...meta } : null;
          })
          .filter(Boolean) as VoicePresenceMember[];
        setPresence((current) => ({ ...current, [channelId]: members }));
      };
      channel.on("presence", { event: "sync" }, sync);
      channel.subscribe((status) => status === "SUBSCRIBED" && sync());
      return channel;
    });

    return () => channels.forEach((channel) => void supabase.removeChannel(channel));
  }, [key]);

  return presence;
}
