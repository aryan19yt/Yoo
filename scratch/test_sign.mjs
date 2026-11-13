import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const envContent = fs.readFileSync("c:\\Desktop\\Projects\\StreamLounge\\.env.local", "utf-8");
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[trimmed.slice(0, eqIdx).trim()] = val;
  }
}

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

async function testSigned() {
  const buckets = [
    "soundboard-audio",
    "soundboard-images",
    "interaction-audio",
    "non-existent-bucket-xyz"
  ];

  for (const b of buckets) {
    const res = await client.storage.from(b).createSignedUrl("test.mp3", 3600);
    console.log(`Bucket [${b}]: data=${!!res.data?.signedUrl}, errorMsg=${res.error?.message}, code=${res.error?.code}, statusCode=${res.error?.statusCode}`);
  }
}

testSigned().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
