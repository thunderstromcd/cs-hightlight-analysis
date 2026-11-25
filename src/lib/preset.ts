// Fixed recording preset. The page tells people what they will get.
// It does not offer knobs for resolution, frame rate, or HUD.
export const RECORDING_PRESET = {
  width: 1280,
  height: 720,
  framerate: 30,
  showOnlyDeathNotices: true,
  concatenateSequences: true,
  oneAtATime: true,
  recordingSystem: "CS",
  recordingOutput: "video",
  encoderSoftware: "FFmpeg",
  videoContainer: "mp4",
} as const;

export const RECORDER_NOT_READY_MESSAGE =
  "录像机未就绪。这台电脑上找不到 csdm，所以现在不能让 CS2 把片段录成 MP4。分析和勾选不受影响。导出要等同一台 Windows 上安装好 CS Demo Manager 的命令行（csdm 在 PATH 里，或用环境变量 CSDM_PATH 指向 csdm.exe），并且本机已经安装 CS2。这个网站不会替你安装它们。";
