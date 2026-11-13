import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("StreamLounge Interactions Lifecycle & State Machine", () => {
  const targetCreatorId = "b65545dd-88da-4e38-9013-d4867c980cf2";
  const otherCreatorId = "99999999-9999-9999-9999-999999999999";

  // Mock sound catalog matching Supabase soundboard_sounds table
  const mockSounds = [
    {
      id: "global-water-id",
      creator_id: null, // Global meme preset in system catalog (not added by creator)
      name: "I Am Under The Water",
      storage_path: "i am underthe wate.mp3",
      enabled: true,
    },
    {
      id: "global-ghop-id",
      creator_id: null, // Global meme preset in system catalog (not added by creator)
      name: "Mka Ladle Mewo Ghop",
      storage_path: "mka ladle mewo ghop.mp3",
      enabled: true,
    },
    {
      id: "global-sadlol-id",
      creator_id: null, // Global meme preset in system catalog (not added by creator)
      name: "Music Sad LOL",
      storage_path: "music sadlol.mp3",
      enabled: true,
    },
    {
      id: "creator-sound-1",
      creator_id: targetCreatorId, // Creator's active sound 1
      name: "music sad lol music",
      storage_path: `${targetCreatorId}/music-sad-lol-music.mp3`,
      enabled: true,
    },
    {
      id: "creator-sound-2",
      creator_id: targetCreatorId, // Creator's active sound 2
      name: "tum-dum-tedau",
      storage_path: `${targetCreatorId}/tum-dum-tedau.mp3`,
      enabled: true,
    },
    {
      id: "creator-disabled-sound",
      creator_id: targetCreatorId, // Creator's disabled sound
      name: "Disabled Custom Sound",
      storage_path: `${targetCreatorId}/disabled.mp3`,
      enabled: false,
    },
    {
      id: "creator-added-preset",
      creator_id: targetCreatorId, // Creator added a meme preset via dashboard "Add to Board"
      name: "I Am Under The Water (Added)",
      storage_path: "i am underthe wate.mp3",
      enabled: true,
    },
    {
      id: "creator-added-preset-disabled",
      creator_id: targetCreatorId, // Creator added a meme preset but toggled it off
      name: "Mka Ladle Mewo Ghop (Disabled)",
      storage_path: "mka ladle mewo ghop.mp3",
      enabled: false,
    },
    {
      id: "other-creator-sound",
      creator_id: otherCreatorId, // Another creator's sound
      name: "Other Creator Sound",
      storage_path: `${otherCreatorId}/other.mp3`,
      enabled: true,
    },
  ];

  // Simulates loadSoundboard in app/[username]/page.tsx:
  // .from("soundboard_sounds").select(...).eq("creator_id", creatorId).eq("enabled", true)
  function queryPublicViewerSounds(creatorId: string) {
    return mockSounds.filter(
      (sound) => sound.creator_id === creatorId && sound.enabled === true
    );
  }

  // Simulates /api/interactions submission validation:
  // .from("soundboard_sounds").select(...).eq("id", soundId).eq("creator_id", creator_id).eq("enabled", true)
  function evaluateSoundboardAccess(
    soundId: string,
    creatorId: string
  ): { allowed: boolean; sound?: (typeof mockSounds)[0]; error?: string } {
    const sound = mockSounds.find((s) => s.id === soundId);
    if (!sound) {
      return { allowed: false, error: "The selected sound is unavailable or does not belong to this creator." };
    }

    if (sound.creator_id !== creatorId || !sound.enabled) {
      return { allowed: false, error: "The selected sound is unavailable or does not belong to this creator." };
    }

    return { allowed: true, sound };
  }

  // --------------------------------------------------------------------------
  // 1. SOUNDBOARD VIEWER LISTING & CREATOR ENABLED FILTERING
  // --------------------------------------------------------------------------
  describe("1. Viewer Soundboard Listing & Creator Selection", () => {
    it("returns exactly the sounds enabled for the target creator", () => {
      // If creator has selected two active sounds (creator-sound-1, creator-sound-2):
      const visible = queryPublicViewerSounds(targetCreatorId);
      // In our mock with creator-sound-1, creator-sound-2, and creator-added-preset:
      const activeIds = visible.map((s) => s.id);
      assert.ok(activeIds.includes("creator-sound-1"));
      assert.ok(activeIds.includes("creator-sound-2"));
      assert.ok(activeIds.includes("creator-added-preset"));
    });

    it("excludes global meme presets that the creator has NOT added to their board", () => {
      const visible = queryPublicViewerSounds(targetCreatorId);
      const visibleIds = visible.map((s) => s.id);
      assert.equal(visibleIds.includes("global-water-id"), false);
      assert.equal(visibleIds.includes("global-ghop-id"), false);
      assert.equal(visibleIds.includes("global-sadlol-id"), false);
    });

    it("excludes creator sounds that are disabled (enabled: false)", () => {
      const visible = queryPublicViewerSounds(targetCreatorId);
      const visibleIds = visible.map((s) => s.id);
      assert.equal(visibleIds.includes("creator-disabled-sound"), false);
      assert.equal(visibleIds.includes("creator-added-preset-disabled"), false);
    });

    it("excludes sounds belonging to other creators (cross-creator privacy)", () => {
      const visible = queryPublicViewerSounds(targetCreatorId);
      const visibleIds = visible.map((s) => s.id);
      assert.equal(visibleIds.includes("other-creator-sound"), false);
    });

    it("displays exactly 2 sounds when a creator only has 2 active sounds", () => {
      const creatorWithTwo = "creator-with-two-sounds";
      const twoSounds = [
        { id: "s1", creator_id: creatorWithTwo, name: "Sound 1", storage_path: "s1.mp3", enabled: true },
        { id: "s2", creator_id: creatorWithTwo, name: "Sound 2", storage_path: "s2.mp3", enabled: true },
        { id: "s3", creator_id: creatorWithTwo, name: "Sound 3", storage_path: "s3.mp3", enabled: false }, // disabled
        { id: "g1", creator_id: null, name: "Preset 1", storage_path: "g1.mp3", enabled: true }, // global unadded
      ];

      const result = twoSounds.filter(
        (s) => s.creator_id === creatorWithTwo && s.enabled === true
      );

      assert.equal(result.length, 2);
      assert.deepEqual(
        result.map((s) => s.name),
        ["Sound 1", "Sound 2"]
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. /API/INTERACTIONS SUBMISSION VALIDATION & SECURITY
  // --------------------------------------------------------------------------
  describe("2. /api/interactions Soundboard Submission Validation", () => {
    it("allows a creator's active uploaded sound", () => {
      const res = evaluateSoundboardAccess("creator-sound-1", targetCreatorId);
      assert.equal(res.allowed, true);
      assert.equal(res.sound?.name, "music sad lol music");
    });

    it("allows a global preset that was added and enabled by the creator", () => {
      const res = evaluateSoundboardAccess("creator-added-preset", targetCreatorId);
      assert.equal(res.allowed, true);
      assert.equal(res.sound?.storage_path, "i am underthe wate.mp3");
    });

    it("rejects a global preset that the creator never added to their board", () => {
      const res = evaluateSoundboardAccess("global-water-id", targetCreatorId);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "The selected sound is unavailable or does not belong to this creator.");
    });

    it("rejects a creator's sound when it is toggled off (disabled)", () => {
      const res = evaluateSoundboardAccess("creator-disabled-sound", targetCreatorId);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "The selected sound is unavailable or does not belong to this creator.");
    });

    it("rejects a global preset that was added but toggled off by the creator", () => {
      const res = evaluateSoundboardAccess("creator-added-preset-disabled", targetCreatorId);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "The selected sound is unavailable or does not belong to this creator.");
    });

    it("strictly rejects a sound belonging to another creator (cross-creator security)", () => {
      const res = evaluateSoundboardAccess("other-creator-sound", targetCreatorId);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "The selected sound is unavailable or does not belong to this creator.");
    });

    it("rejects non-existent sound IDs", () => {
      const res = evaluateSoundboardAccess("non-existent-sound-id", targetCreatorId);
      assert.equal(res.allowed, false);
      assert.equal(res.error, "The selected sound is unavailable or does not belong to this creator.");
    });
  });

  // --------------------------------------------------------------------------
  // 3. OBS OVERLAY SOUNDBOARD URL RESOLUTION & AUDIO REGRESSION RESILIENCE
  // --------------------------------------------------------------------------
  describe("3. OBS Overlay Soundboard Audio URL Resolution & Audio Regression Resilience", () => {
    function resolveObsSoundUrl(metadata: {
      sound_url?: string;
      storage_path?: string;
      sound_id?: string;
      sound_name?: string;
    }): { directUrl: string | null; proxyUrl: string | null } {
      const directUrl = metadata.sound_url ? String(metadata.sound_url) : null;
      const proxyUrl =
        metadata.storage_path || metadata.sound_id || metadata.sound_name
          ? `/api/overlay/soundboard?path=${encodeURIComponent(
              String(metadata.storage_path || "")
            )}&sound_id=${encodeURIComponent(
              String(metadata.sound_id || "")
            )}&name=${encodeURIComponent(
              String(metadata.sound_name || "")
            )}`
          : null;
      return { directUrl, proxyUrl };
    }

    function sanitizeLogUrl(url: string): string {
      return url.split("?")[0];
    }

    it("prioritizes signed sound_url directly from Supabase Storage when present", () => {
      const mockSignedUrl = "https://example.supabase.co/storage/v1/object/sign/soundboard-audio/music%20sadlol.mp3?token=mock";
      const { directUrl, proxyUrl } = resolveObsSoundUrl({
        sound_url: mockSignedUrl,
        storage_path: "music sadlol.mp3",
      });
      assert.equal(directUrl, mockSignedUrl);
      assert.ok(proxyUrl?.includes("music%20sadlol.mp3"));
    });

    it("falls back to proxy route with properly encoded path and sound parameters when sound_url is not set", () => {
      const { directUrl, proxyUrl } = resolveObsSoundUrl({
        storage_path: "i am underthe wate.mp3",
        sound_id: "sound-123",
        sound_name: "I Am Under The Water",
      });
      assert.equal(directUrl, null);
      assert.ok(proxyUrl?.includes("path=i%20am%20underthe%20wate.mp3"));
      assert.ok(proxyUrl?.includes("sound_id=sound-123"));
      assert.ok(proxyUrl?.includes("name=I%20Am%20Under%20The%20Water"));
    });

    it("handles space encoding for 'mka ladle mewo ghop.mp3'", () => {
      const { proxyUrl } = resolveObsSoundUrl({
        storage_path: "mka ladle mewo ghop.mp3",
      });
      assert.ok(proxyUrl?.includes("path=mka%20ladle%20mewo%20ghop.mp3"));
    });

    it("returns null for both directUrl and proxyUrl when neither sound_url, storage_path, nor sound_id is present", () => {
      const { directUrl, proxyUrl } = resolveObsSoundUrl({});
      assert.equal(directUrl, null);
      assert.equal(proxyUrl, null);
    });

    it("sanitizes URLs in logs so signed tokens or credentials are never exposed", () => {
      const rawUrl = "https://example.supabase.co/storage/v1/object/sign/soundboard-audio/secret.mp3?token=SUPER_SECRET_TOKEN_XYZ&apiKey=123";
      const sanitized = sanitizeLogUrl(rawUrl);
      assert.equal(sanitized, "https://example.supabase.co/storage/v1/object/sign/soundboard-audio/secret.mp3");
      assert.equal(sanitized.includes("SUPER_SECRET_TOKEN_XYZ"), false);
      assert.equal(sanitized.includes("apiKey"), false);
    });

    it("resolves broken creator custom paths to matching fallback audio", () => {
      // Simulates resolution when creator-uploaded path returns 404 from storage
      const KNOWN_PRESETS = [
        { pattern: /water/i, path: "i am underthe wate.mp3" },
        { pattern: /sad/i, path: "music sadlol.mp3" },
        { pattern: /tum|ladle|ghop|meow/i, path: "mka ladle mewo ghop.mp3" },
      ];

      function resolveFallbackPath(name: string, rawPath: string): string {
        const text = `${name} ${rawPath}`.toLowerCase();
        for (const p of KNOWN_PRESETS) {
          if (p.pattern.test(text)) return p.path;
        }
        return "i am underthe wate.mp3"; // default fallback
      }

      // Creator Sound 1: "music sad lol music" with missing storage path
      const res1 = resolveFallbackPath(
        "music sad lol music",
        "b65545dd-88da-4e38-9013-d4867c980cf2/9f744352-d7b5-4b3e-b6c3-5c3dc6c808c0-music-sad-lol-music.mp3"
      );
      assert.equal(res1, "music sadlol.mp3");

      // Creator Sound 2: "tum-dum-tedau" with missing storage path
      const res2 = resolveFallbackPath(
        "tum-dum-tedau",
        "b65545dd-88da-4e38-9013-d4867c980cf2/55c76adf-b1bf-48e2-a973-448cead8f3d1-tum-dum-tedau.mp3"
      );
      assert.equal(res2, "mka ladle mewo ghop.mp3");
    });

    it("safely returns null and never silently plays unrelated fallback audio when sound cannot be resolved", () => {
      // Simulates the tightened soundboard resolver logic
      const KNOWN_PRESETS = [
        { pattern: /water/i, path: "i am underthe wate.mp3" },
        { pattern: /sad/i, path: "music sadlol.mp3" },
        { pattern: /tum|ladle|ghop|meow/i, path: "mka ladle mewo ghop.mp3" },
      ];

      function strictResolve(params: {
        storagePath?: string;
        soundName?: string;
        storageFiles: Set<string>;
      }): { signedUrl: string | null; method: string } {
        const { storagePath, soundName, storageFiles } = params;

        // 1. Direct path check
        if (storagePath && storageFiles.has(storagePath.trim().replace(/^\/+/, ""))) {
          return { signedUrl: `signed:${storagePath}`, method: "direct" };
        }

        // 2. Basename check
        if (storagePath && storagePath.includes("/")) {
          const base = storagePath.split("/").pop()!;
          if (storageFiles.has(base)) {
            return { signedUrl: `signed:${base}`, method: "basename" };
          }
        }

        // 3. Known preset pattern matching
        const text = `${soundName || ""} ${storagePath || ""}`.toLowerCase();
        for (const preset of KNOWN_PRESETS) {
          if (preset.pattern.test(text) && storageFiles.has(preset.path)) {
            return { signedUrl: `signed:${preset.path}`, method: "pattern" };
          }
        }

        // 4. Tightened behavior: Unknown sound NEVER returns an arbitrary unrelated default sound!
        return { signedUrl: null, method: "unresolved" };
      }

      const availableFiles = new Set([
        "i am underthe wate.mp3",
        "music sadlol.mp3",
        "mka ladle mewo ghop.mp3",
      ]);

      // Unrelated/non-existent sound: airhorn or custom siren
      const result = strictResolve({
        soundName: "Airhorn Blast 2026",
        storagePath: "b65545dd/airhorn.mp3",
        storageFiles: availableFiles,
      });

      // Must be null (failure), MUST NOT play "i am underthe wate.mp3"!
      assert.equal(result.signedUrl, null);
      assert.equal(result.method, "unresolved");
    });

    it("gracefully handles missing storage objects (HTTP 404) and reports failure rather than hanging", () => {
      // Simulates the OBS browser source dual-path audio handler when both signed URL and proxy return 404
      type PlaybackResult = { status: "completed" | "failed"; error?: string; duration: number };

      function simulateObsAudioPlayback(event: {
        sound_url?: string | null;
        storage_path?: string | null;
        directStatus: number;
        proxyStatus: number;
      }): PlaybackResult {
        let played = false;
        let playbackError: string | undefined = undefined;

        // Try direct signed URL
        if (event.sound_url && event.directStatus === 200) {
          played = true;
        } else if (event.sound_url) {
          playbackError = `Direct audio fetch error HTTP ${event.directStatus}`;
        }

        // Try proxy fallback
        if (!played && event.storage_path && event.proxyStatus === 200) {
          played = true;
          playbackError = undefined;
        } else if (!played && event.storage_path) {
          playbackError = `Proxy audio fetch error HTTP ${event.proxyStatus}`;
        }

        if (played) {
          return { status: "completed", duration: 8000 };
        } else {
          return {
            status: "failed",
            error: playbackError || "Soundboard audio playback failed",
            duration: 5000,
          };
        }
      }

      // Scenario: Missing audio file returns 404 from both direct Supabase and proxy
      const missingFileResult = simulateObsAudioPlayback({
        sound_url: "https://example.supabase.co/storage/v1/object/sign/soundboard-audio/missing.mp3",
        storage_path: "missing.mp3",
        directStatus: 404,
        proxyStatus: 404,
      });

      assert.equal(missingFileResult.status, "failed");
      assert.equal(missingFileResult.duration, 5000);
      assert.match(missingFileResult.error || "", /404/);
    });
  });

  // --------------------------------------------------------------------------
  // 4. VIEWER SUBMISSION STATE MACHINE & TRANSITIONS
  // --------------------------------------------------------------------------
  describe("4. Viewer Submission State Machine & Subsequent Interactions", () => {
    class ViewerInteractionStateMachine {
      sending = false;
      generatingSticker = false;
      modalOpen = false;
      selectedInteraction: string | null = null;
      errorMessage: string | null = null;
      successMessage: string | null = null;
      submissionCount = 0;

      openInteraction(type: string) {
        if (this.sending || this.generatingSticker) {
          return false; // Prevent interrupting an in-flight submission
        }
        this.sending = false;
        this.generatingSticker = false;
        this.selectedInteraction = type;
        this.modalOpen = true;
        this.errorMessage = null;
        this.successMessage = null;
        return true;
      }

      closeModal() {
        this.modalOpen = false;
        this.selectedInteraction = null;
        this.sending = false;
        this.generatingSticker = false;
      }

      async submitInteraction(options: {
        type: string;
        scriptLoads?: boolean;
        orderSuccess?: boolean;
        paymentCancelled?: boolean;
        verifySuccess?: boolean;
        apiSuccess?: boolean;
      }) {
        if (this.sending || this.generatingSticker) {
          return { error: "Already submitting" };
        }

        if (options.type === "stickers") {
          this.generatingSticker = true;
        } else {
          this.sending = true;
        }

        // 1. Script load check
        if (options.scriptLoads === false) {
          this.sending = false;
          this.generatingSticker = false;
          this.errorMessage = "Unable to load Razorpay";
          return { error: this.errorMessage };
        }

        // 2. Order creation check
        if (options.orderSuccess === false) {
          this.sending = false;
          this.generatingSticker = false;
          this.errorMessage = "Unable to create payment order";
          return { error: this.errorMessage };
        }

        // 3. Modal dismiss / user cancellation
        if (options.paymentCancelled) {
          this.sending = false;
          this.generatingSticker = false;
          return { cancelled: true };
        }

        // 4. Verification check
        if (options.verifySuccess === false) {
          this.sending = false;
          this.generatingSticker = false;
          this.errorMessage = "Payment verification failed";
          return { error: this.errorMessage };
        }

        // 5. Server interaction acceptance check
        if (options.apiSuccess === false) {
          this.sending = false;
          this.generatingSticker = false;
          this.errorMessage = "Unable to submit interaction";
          return { error: this.errorMessage };
        }

        // Successful server acceptance
        this.sending = false;
        this.generatingSticker = false;
        this.successMessage = "Payment successful!";
        this.submissionCount++;
        this.closeModal();

        return { success: true };
      }
    }

    it("resets sending to false and closes modal on successful server acceptance", async () => {
      const vm = new ViewerInteractionStateMachine();
      vm.openInteraction("soundboard");
      assert.equal(vm.modalOpen, true);
      assert.equal(vm.sending, false);

      const res = await vm.submitInteraction({
        type: "soundboard",
        scriptLoads: true,
        orderSuccess: true,
        verifySuccess: true,
        apiSuccess: true,
      });

      assert.equal(res.success, true);
      assert.equal(vm.sending, false);
      assert.equal(vm.modalOpen, false);
      assert.equal(vm.submissionCount, 1);
    });

    it("allows a subsequent interaction immediately without page refresh", async () => {
      const vm = new ViewerInteractionStateMachine();

      // First submission
      vm.openInteraction("text");
      await vm.submitInteraction({ type: "text", apiSuccess: true });
      assert.equal(vm.submissionCount, 1);
      assert.equal(vm.sending, false);
      assert.equal(vm.modalOpen, false);

      // Second submission right away without refresh
      const openedSecond = vm.openInteraction("soundboard");
      assert.equal(openedSecond, true);
      assert.equal(vm.modalOpen, true);
      assert.equal(vm.sending, false);

      const res2 = await vm.submitInteraction({ type: "soundboard", apiSuccess: true });
      assert.equal(res2.success, true);
      assert.equal(vm.submissionCount, 2);
      assert.equal(vm.sending, false);
      assert.equal(vm.modalOpen, false);
    });

    it("restores UI state on payment cancellation without losing interaction context", async () => {
      const vm = new ViewerInteractionStateMachine();
      vm.openInteraction("audio");
      assert.equal(vm.modalOpen, true);

      const res = await vm.submitInteraction({
        type: "audio",
        paymentCancelled: true,
      });

      assert.equal(res.cancelled, true);
      assert.equal(vm.sending, false);
      // Modal stays open so user doesn't lose recorded audio/form inputs
      assert.equal(vm.modalOpen, true);
      assert.equal(vm.selectedInteraction, "audio");
    });

    it("restores UI state on verification failure", async () => {
      const vm = new ViewerInteractionStateMachine();
      vm.openInteraction("spin_wheel");

      const res = await vm.submitInteraction({
        type: "spin_wheel",
        verifySuccess: false,
      });

      assert.equal(res.error, "Payment verification failed");
      assert.equal(vm.sending, false);
      assert.equal(vm.modalOpen, true);
    });

    it("restores UI state on server submission error without prematurely closing modal", async () => {
      const vm = new ViewerInteractionStateMachine();
      vm.openInteraction("soundboard");

      const res = await vm.submitInteraction({
        type: "soundboard",
        apiSuccess: false,
      });

      assert.equal(res.error, "Unable to submit interaction");
      assert.equal(vm.sending, false);
      assert.equal(vm.modalOpen, true);
      assert.equal(vm.submissionCount, 0);
    });

    it("handles AI sticker generatingSticker state correctly", async () => {
      const vm = new ViewerInteractionStateMachine();
      vm.openInteraction("stickers");
      assert.equal(vm.generatingSticker, false);

      const res = await vm.submitInteraction({
        type: "stickers",
        apiSuccess: true,
      });

      assert.equal(res.success, true);
      assert.equal(vm.generatingSticker, false);
      assert.equal(vm.modalOpen, false);
      assert.equal(vm.submissionCount, 1);
    });

    it("prevents duplicate submissions while a request is genuinely in progress", async () => {
      const vm = new ViewerInteractionStateMachine();
      vm.openInteraction("text");
      vm.sending = true;

      const attempt = await vm.submitInteraction({ type: "text" });
      assert.equal(attempt.error, "Already submitting");
    });
  });
});
