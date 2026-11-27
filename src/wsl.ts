import { invoke } from "@tauri-apps/api/core";

export function wslLocation(path: string) {
  const unc = path.replaceAll("/", "\\").replace(/^\\\\\?\\UNC\\/i, "\\\\");
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i.exec(unc);
  if (!match) return null;
  return { distribution: match[1], path: "/" + (match[2] ?? "").replaceAll("\\", "/") };
}

export function wslHome(distribution?: string) {
  return invoke<string>("wsl_home", { distribution });
}
