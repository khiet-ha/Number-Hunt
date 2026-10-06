import type { LocalStatus } from "../multiplayer/protocol";

export const STATUS_TEXT: Record<LocalStatus, string> = {
  LOBBY: "Phòng chờ",
  SYNCING: "Đang đồng bộ…",
  ACTIVE: "Đã kết nối",
  MIGRATING: "Đang bầu Host mới…",
  PAUSED: "Tạm dừng — chờ đủ người",
  DESYNC: "Lỗi đồng bộ",
  CLOSED: "Đã đóng",
};

export const REJECT_TEXT: Record<string, string> = {
  wrongNumber: "Sai số!",
  lostRace: "Chậm hơn một chút!",
  reserved: "Có người nhanh hơn!",
  claimed: "Số đã được tìm",
  noQuorum: "Đang chờ đủ người",
  staleTerm: "Host vừa đổi",
  phase: "Chưa thể bấm",
  timeout: "Mất kết nối Host",
  notHost: "Host vừa đổi",
};

export const CLOSE_TEXT: Record<string, string> = {
  hostLeft: "Host đã rời phòng chờ. Phòng đã đóng.",
  removed: "Bạn đã bị loại khỏi phòng.",
  left: "Bạn đã rời phòng.",
};

export const BLOCKER_TEXT: Record<string, string> = {
  needPlayers: "Cần ít nhất 2 người chơi",
  notReady: "Chưa phải ai cũng sẵn sàng",
  meshIncomplete: "Các máy đang kết nối với nhau…",
};
