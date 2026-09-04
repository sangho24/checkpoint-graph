/* mock 독서 이력. data/reading-history.json 과 같은 내용이다.
   실제 기록이 아니라 백테스트 설계 검증용 가짜 데이터다.
   fetch() 는 file:// 에서 CORS 로 막히므로 HTML 에 <script> 로 인라인해서 쓴다.
   형식: [node_id, read_at, reaction, source] */
const READING_HISTORY = [
  ["attention", "2026-04-02T21:38:00+09:00", "liked", "zotero"],
  ["moe", "2026-04-02T22:55:00+09:00", "read", "browser_history"],
  ["switch", "2026-04-06T22:12:00+09:00", "liked", "zotero"],
  ["gshard", "2026-04-09T20:47:00+09:00", "read", "browser_history"],
  ["expertchoice", "2026-04-11T14:22:00+09:00", "read", "zotero"],
  ["mod", "2026-04-11T16:08:00+09:00", "read", "browser_history"],
  ["ddpm", "2026-04-11T17:44:00+09:00", "skipped", "browser_history"],
  ["mixtral", "2026-04-14T21:26:00+09:00", "liked", "zotero"],
  ["dsv2", "2026-04-19T15:10:00+09:00", "read", "zotero"],
  ["dsv3", "2026-04-23T22:31:00+09:00", "liked", "zotero"],
  ["a-kipply", "2026-04-28T21:16:00+09:00", "read", "browser_history"],
  ["mqa", "2026-05-03T13:52:00+09:00", "skipped", "browser_history"],
  ["gqa", "2026-05-06T22:20:00+09:00", "read", "zotero"],
  ["flash", "2026-05-07T21:03:00+09:00", "liked", "zotero"],
  ["flash2", "2026-05-12T23:11:00+09:00", "read", "browser_history"],
  ["rope", "2026-05-18T22:26:00+09:00", "read", "browser_history"],
  ["vllm", "2026-05-23T13:40:00+09:00", "liked", "zotero"],
  ["specdec", "2026-05-23T15:15:00+09:00", "read", "browser_history"],
  ["medusa", "2026-05-23T16:52:00+09:00", "read", "browser_history"],
  ["streaming", "2026-05-23T20:30:00+09:00", "read", "browser_history"],
  ["ring", "2026-05-28T22:05:00+09:00", "read", "manual"],
  ["clip", "2026-06-03T21:48:00+09:00", "skipped", "browser_history"],
  ["mistral", "2026-06-09T20:36:00+09:00", "read", "browser_history"],
  ["llama2", "2026-06-13T14:12:00+09:00", "read", "zotero"],
  ["chinchilla", "2026-06-18T22:24:00+09:00", "liked", "zotero"],
  ["scaling", "2026-06-24T21:57:00+09:00", "skipped", "browser_history"],
  ["lora", "2026-06-30T20:52:00+09:00", "read", "browser_history"],
  ["qlora", "2026-07-03T22:41:00+09:00", "read", "zotero"],
  ["a-scale", "2026-07-09T21:15:00+09:00", "liked", "browser_history"],
  ["megatron", "2026-07-11T14:26:00+09:00", "read", "manual"],
  ["zero", "2026-07-12T16:03:00+09:00", "read", "zotero"],
  ["whisper", "2026-07-18T15:37:00+09:00", "skipped", "browser_history"],
  ["llama3", "2026-07-25T13:52:00+09:00", "read", "browser_history"],
  ["qwen2", "2026-08-02T15:44:00+09:00", "read", "browser_history"],
  ["ldm", "2026-08-09T16:58:00+09:00", "skipped", "browser_history"],
  ["mamba", "2026-08-17T21:12:00+09:00", "read", "manual"],
  ["dsr1", "2026-08-26T22:34:00+09:00", "liked", "zotero"],
  ["a-weng", "2026-09-03T22:09:00+09:00", "read", "browser_history"],
];

/* 총 38개 엔트리. 기간: 2026-04-02 ~ 2026-09-03 (Asia/Seoul).
   dwell_min 등 나머지 필드는 data/reading-history.json 을 참조. */
