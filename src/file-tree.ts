import { invoke } from "@tauri-apps/api/core";

interface Entry { name: string; dir: boolean }
interface Node extends Entry { path: string; parent?: Node; children?: Node[]; loading?: boolean }
const join = (path: string, name: string) => path.replace(/[\\/]$/, "") + (path.includes("\\") ? "\\" : "/") + name;

export class FileTree {
  private roots: Node[] = [];
  private nodes = new Map<string, Node>();
  private disposed = false;
  private filter = "";
  private selected = "";

  constructor(
    private host: HTMLElement,
    private expanded: Set<string>,
    private open: (path: string, alt: boolean) => void,
    private error: (message: string) => void,
  ) {}

  dispose() { this.disposed = true; }
  isExpanded(path: string) { return this.expanded.has(path); }
  async load(path: string) {
    this.roots = await this.read(path);
    if (this.disposed) return;
    this.render();
    await this.restore(this.roots);
  }
  private async read(path: string, parent?: Node): Promise<Node[]> {
    const entries = await invoke<Entry[]>("list_dir", { path });
    if (this.disposed) return [];
    return entries.map(entry => {
      const node = { ...entry, path: join(path, entry.name), parent };
      this.nodes.set(node.path, node);
      return node;
    });
  }
  private async restore(nodes: Node[]) {
    for (const node of nodes) {
      if (this.disposed) return;
      if (node.dir && this.expanded.has(node.path)) await this.expand(node);
    }
  }
  private async expand(node: Node) {
    if (node.loading) return;
    this.expanded.add(node.path);
    if (node.children) { this.render(); return; }
    node.loading = true;
    this.render();
    try {
      node.children = await this.read(node.path, node);
      if (!this.disposed && this.expanded.has(node.path)) await this.restore(node.children);
    } catch (error) {
      this.expanded.delete(node.path);
      if (!this.disposed) this.error(`无法读取 ${node.name}：${error}`);
    } finally {
      node.loading = false;
      if (!this.disposed) this.render();
    }
  }
  async toggle(path: string) {
    const node = this.nodes.get(path);
    if (!node?.dir) return;
    this.selected = path;
    if (this.expanded.has(path)) { this.expanded.delete(path); this.render(); }
    else await this.expand(node);
  }
  setFilter(value: string) { this.filter = value.trim().toLowerCase(); this.render(); }
  private render() {
    if (this.disposed) return;
    const focusPath = this.host.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.path : undefined;
    const matches = (node: Node): boolean => !this.filter || node.name.toLowerCase().includes(this.filter) || !!node.children?.some(matches);
    const rows: HTMLElement[] = [];
    const visit = (nodes: Node[], depth: number) => {
      const visible = nodes.filter(matches);
      visible.forEach((node, index) => {
        const row = document.createElement("li");
        const expanded = this.expanded.has(node.path);
        row.className = `tree-row${node.dir ? " dir" : ""}${node.path === this.selected ? " sel" : ""}`;
        row.style.paddingLeft = `${8 + depth * 16}px`;
        row.dataset.path = node.path;
        row.dataset.dir = String(node.dir);
        row.dataset.name = node.name.toLowerCase();
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(depth + 1));
        row.setAttribute("aria-posinset", String(index + 1));
        row.setAttribute("aria-setsize", String(visible.length));
        row.setAttribute("aria-selected", String(node.path === this.selected));
        if (node.dir) row.setAttribute("aria-expanded", String(expanded));
        if (node.loading) row.setAttribute("aria-busy", "true");
        row.tabIndex = -1;
        row.title = `${node.path}\n${node.dir ? "点击展开 / 折叠" : "点击打开"} · 右键操作 · Alt+点击插入路径`;
        const arrow = document.createElement("span");
        arrow.className = "tree-arrow";
        arrow.textContent = node.dir ? node.loading ? "⋯" : expanded ? "▾" : "▸" : "";
        arrow.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.className = "tree-name";
        label.textContent = node.name;
        row.append(arrow, label);
        const activate = (alt: boolean) => {
          this.selected = node.path;
          if (alt || !node.dir) { this.render(); this.open(node.path, alt); }
          else void this.toggle(node.path);
        };
        row.onclick = event => activate(event.altKey);
        row.onkeydown = event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(event.altKey); return; }
          let target: HTMLElement | undefined;
          const current = rows.indexOf(row);
          if (event.key === "ArrowDown") target = rows[current + 1];
          else if (event.key === "ArrowUp") target = rows[current - 1];
          else if (event.key === "Home") target = rows[0];
          else if (event.key === "End") target = rows.at(-1);
          else if (event.key === "ArrowRight") {
            if (node.dir && !expanded) void this.toggle(node.path);
            else if (node.children?.length) target = rows[current + 1];
          } else if (event.key === "ArrowLeft") {
            if (node.dir && expanded) void this.toggle(node.path);
            else target = rows.find(row => row.dataset.path === node.parent?.path);
          } else return;
          event.preventDefault();
          target?.focus();
        };
        rows.push(row);
        if (expanded && node.children) visit(node.children, depth + 1);
      });
    };
    visit(this.roots, 0);
    const active = rows.find(row => row.dataset.path === focusPath) || rows.find(row => row.dataset.path === this.selected) || rows[0];
    if (active) active.tabIndex = 0;
    this.host.replaceChildren(...rows);
    if (focusPath) active?.focus();
  }
}
