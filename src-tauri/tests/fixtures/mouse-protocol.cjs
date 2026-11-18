// Match pi's startup order: enter fullscreen and enable mouse before raw input.
// The system ConPTY drops these mouse modes; the bundled host must preserve them.
const enable = "\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1004h\x1b[?1006h";
const disable = "\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1049l";
const expected = "\x1b[<64;10;5M\x1b[<65;10;5M\x1b[<0;12;6M\x1b[<32;14;6M\x1b[<0;14;6m";
process.stdout.write(enable);
process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", data => {
  input += data;
  if (input === expected) {
    process.stdout.write("MOUSE_INPUT_OK" + disable + "NORMAL_SCREEN_OK", () => process.exit(0));
  } else if (!expected.startsWith(input)) {
    process.stdout.write("BAD_INPUT:" + JSON.stringify(input), () => process.exit(1));
  }
});
process.stdout.write("MOUSE_READY");
setTimeout(() => process.exit(2), 10_000).unref();
