import { createConnection } from "node:net";

// next build 会覆盖运行中的 next start 正在使用的 .next 文件。
const socket = createConnection({ host: "127.0.0.1", port: 38471 });
socket.once("connect", () => {
  console.error("38471 服务仍在运行。请先停止服务，再执行 npm run build，构建完成后执行 npm start。");
  process.exitCode = 1;
  socket.destroy();
});
socket.once("error", (error) => {
  if (error.code !== "ECONNREFUSED") {
    console.error(error.message);
    process.exitCode = 1;
  }
});
