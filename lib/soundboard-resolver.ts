import { SupabaseClient } from "@supabase/supabase-js";

export interface ResolveSoundParams {
  storagePath?: string | null;
  soundId?: string | null;
  soundName?: string | null;
}

export interface ResolvedSoundAudio {
  signedUrl: string | null;
  resolvedPath: string;
  method: string;
}

const KNOWN_PRESETS: Array<{ pattern: RegExp; path: string }> = [
  { pattern: /water/i, path: "i am underthe wate.mp3" },
  { pattern: /sad/i, path: "music sadlol.mp3" },
  { pattern: /tum|ladle|ghop|meow/i, path: "mka ladle mewo ghop.mp3" },
];

/**
 * Resolves a soundboard audio file to a valid signed URL and working storage path.
 *
 * 1. Checks the exact stored path in "soundboard-audio".
 * 2. Attempts clean / decoded path variations.
 * 3. Checks basename if the path contains a user subfolder.
 * 4. Checks known preset mappings based on sound name or path.
 * 5. Queries preset sounds in soundboard_sounds matching the sound.
 * 6. Returns signedUrl: null if unresolved (never plays an unrelated sound).
 */
export async function resolveSoundboardAudio(
  supabase: SupabaseClient,
  params: ResolveSoundParams
): Promise<ResolvedSoundAudio> {
  const { storagePath, soundId, soundName } = params;

  // 1. Direct path check
  if (storagePath) {
    const cleanPath = storagePath.trim().replace(/^\/+/, "");
    if (cleanPath) {
      try {
        const { data, error } = await supabase.storage
          .from("soundboard-audio")
          .createSignedUrl(cleanPath, 3600);

        if (!error && data?.signedUrl) {
          return {
            signedUrl: data.signedUrl,
            resolvedPath: cleanPath,
            method: "direct",
          };
        }
      } catch {
        // Continue to fallback
      }

      // 2. Decoded path check
      try {
        const decoded = decodeURIComponent(cleanPath);
        if (decoded !== cleanPath) {
          const { data, error } = await supabase.storage
            .from("soundboard-audio")
            .createSignedUrl(decoded, 3600);

          if (!error && data?.signedUrl) {
            return {
              signedUrl: data.signedUrl,
              resolvedPath: decoded,
              method: "decoded",
            };
          }
        }
      } catch {
        // Continue to fallback
      }

      // 3. Basename check if stored in a user folder
      if (cleanPath.includes("/")) {
        const baseName = cleanPath.split("/").pop();
        if (baseName) {
          try {
            const { data, error } = await supabase.storage
              .from("soundboard-audio")
              .createSignedUrl(baseName, 3600);

            if (!error && data?.signedUrl) {
              return {
                signedUrl: data.signedUrl,
                resolvedPath: baseName,
                method: "basename",
              };
            }
          } catch {
            // Continue to fallback
          }
        }
      }
    }
  }

  // 4. Resolve name from DB if soundId is provided but soundName was omitted
  let resolvedName = soundName ? String(soundName).trim() : "";
  if (!resolvedName && soundId) {
    try {
      const { data: soundRow } = await supabase
        .from("soundboard_sounds")
        .select("name, storage_path")
        .eq("id", String(soundId))
        .maybeSingle();

      if (soundRow?.name) {
        resolvedName = soundRow.name;
      }
    } catch {
      // Continue to fallback
    }
  }

  // 5. Pattern matching against known audio presets
  const targetText = `${resolvedName} ${storagePath || ""}`.toLowerCase();
  for (const preset of KNOWN_PRESETS) {
    if (preset.pattern.test(targetText)) {
      try {
        const { data, error } = await supabase.storage
          .from("soundboard-audio")
          .createSignedUrl(preset.path, 3600);

        if (!error && data?.signedUrl) {
          return {
            signedUrl: data.signedUrl,
            resolvedPath: preset.path,
            method: `pattern-fallback:${preset.path}`,
          };
        }
      } catch {
        // Continue to next preset
      }
    }
  }

  // 6. Check active presets from soundboard_sounds (creator_id IS NULL) that match the requested sound
  try {
    const { data: dbPresets } = await supabase
      .from("soundboard_sounds")
      .select("name, storage_path")
      .is("creator_id", null)
      .eq("enabled", true);

    if (dbPresets && dbPresets.length > 0) {
      for (const preset of dbPresets) {
        if (!preset.storage_path) continue;
        const pPath = preset.storage_path.trim().replace(/^\/+/, "");
        if (/(^|\/)memes\//.test(pPath)) continue; // Skip known placeholder paths

        const nameMatches =
          resolvedName &&
          preset.name &&
          (preset.name.toLowerCase().includes(resolvedName.toLowerCase()) ||
            resolvedName.toLowerCase().includes(preset.name.toLowerCase()));

        const pathMatches =
          storagePath &&
          preset.storage_path &&
          (preset.storage_path.toLowerCase().includes(storagePath.toLowerCase()) ||
            storagePath.toLowerCase().includes(preset.storage_path.toLowerCase()));

        if (nameMatches || pathMatches) {
          try {
            const { data, error } = await supabase.storage
              .from("soundboard-audio")
              .createSignedUrl(pPath, 3600);

            if (!error && data?.signedUrl) {
              return {
                signedUrl: data.signedUrl,
                resolvedPath: pPath,
                method: `db-preset:${preset.name}`,
              };
            }
          } catch {
            // Continue to next preset
          }
        }
      }
    }
  } catch {
    // Continue to unresolved return
  }

  // 7. If sound cannot be resolved, return signedUrl: null safely to avoid silently playing an unrelated sound
  return {
    signedUrl: null,
    resolvedPath: storagePath || "",
    method: "unresolved",
  };
}
