// Microsoft.Windows.Console.ConPTY (MIT), pinned independently of the Windows OS.
// Run by build.rs; the verified runtime is also included in the Windows installer.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const version = "1.25.261109001";
const packageHash = "3d77f535df848e44225c2a8912ac844fecb23f3057732b639f3034b587496f09";
const hashes = {
  x64: ["e971856f89748dc3b458125e9afdd79b5e9574a7c937676116d3cbbd3b71f492", "b17e48b07ef153b420f0a6e178bacd31fb4c3390e21ae746586213fc0719a775"],
  x86: ["914c7eb6840a5cb477e5f2fdd26610ba4272803b96866123cb87e21a8a2366cd", "6ae4b24b04947cc6c497eecd034f576fecd212ec9cd70baf113e2eabe885a103"],
  arm64: ["3608cef830a1c4fbbf3981594ad3f64ebe2df6db98fe43a48a4ca7d2875d8959", "c04334f450b5731930b63a28ac4da8a058367242dbcf2fb9b323ea25e5a23252"],
};
const arch = { x86_64: "x64", x86: "x86", aarch64: "arm64" }[process.argv[2]] ?? process.arch;
if (!hashes[arch]) throw new Error(`Unsupported ConPTY architecture: ${arch}`);
const root = fileURLToPath(new URL("../src-tauri/conpty/", import.meta.url));
const runtime = join(root, "runtime");
const files = ["conpty.dll", "OpenConsole.exe"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const valid = () => files.every((file, i) => existsSync(join(runtime, file)) && sha256(readFileSync(join(runtime, file))) === hashes[arch][i]);

if (!valid()) {
  const cache = join(root, "cache");
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, `${version}.zip`);
  if (!existsSync(archive) || sha256(readFileSync(archive)) !== packageHash) {
    const response = await fetch(`https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/${version}/microsoft.windows.console.conpty.${version}.nupkg`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`ConPTY download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== packageHash) throw new Error("ConPTY package SHA-256 mismatch");
    writeFileSync(archive, bytes);
  }
  mkdirSync(runtime, { recursive: true });
  // Extract only these two entries from the verified official package.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($env:TCLI_CONPTY_PACKAGE)
try {
  $entries = @("runtimes/win-$env:TCLI_CONPTY_ARCH/native/conpty.dll", "build/native/runtimes/$env:TCLI_CONPTY_ARCH/OpenConsole.exe")
  foreach ($name in $entries) {
    $entry = $zip.GetEntry($name)
    if (!$entry) { throw "Missing ConPTY package entry: $name" }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $env:TCLI_CONPTY_DEST $entry.Name), $true)
  }
} finally { $zip.Dispose() }
`;
  try {
    execFileSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      stdio: "inherit",
      env: { ...process.env, TCLI_CONPTY_PACKAGE: archive, TCLI_CONPTY_ARCH: arch, TCLI_CONPTY_DEST: runtime },
    });
    if (!valid()) throw new Error("Extracted ConPTY runtime SHA-256 mismatch");
  } catch (error) {
    for (const file of files) rmSync(join(runtime, file), { force: true });
    throw error;
  }
}
console.log(`ConPTY ${version} (${arch}) verified`);
