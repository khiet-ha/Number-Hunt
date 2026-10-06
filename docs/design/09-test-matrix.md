# 09 — Test matrix (đã tự động hoá)

`tests/game.test.ts` (engine), `tests/multiplayer.test.ts` (simulator), `tests/stress.test.ts`, `tests/qr.test.ts`, `e2e/game.spec.ts` (WebRTC thật trong Chromium).

## A. Game engine — `game.test.ts`
| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| G01 | sequential | 1..N |
| G02 | fixed step | 1, 1+s, 1+2s… |
| G03 | random steps | deterministic theo seed/config, bước ∈ randomSteps |
| G04 | traditional | layout không đổi sau commit |
| G05 | random | layout đổi sau commit |
| G06 | target cuối | FINISHED trong cùng entry |
| G07 | cùng seed | cùng bàn; ô không trùng, nằm trong bàn |
| + | HOST_CHANGED, REMATCH, entry không hợp lệ, hash canonical, quorum | |

## B. Click race — `multiplayer.test.ts`
| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| C01 | một click hợp lệ | +1 ở mọi peer |
| C02 | hai click cùng lúc | đúng một người thắng, người kia nhận reserved/lostRace |
| C03 | tám click cùng lúc | đúng một người thắng |
| C04 | số sai | state không đổi, CLICK_REJECT |
| C05 | double click | +1 |
| C06 | requestId trùng | bỏ qua |
| C07 | click khi migrate | bị bỏ ở client |
| C08 | click term cũ | reject |
| C09 | số đã claimed | reject |
| C10 (sửa) | proposal thiếu quorum | không ai được điểm, Host PAUSED; có quorum lại ⇒ commit tối đa một lần, hội tụ |

## C. Thứ tự event
| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| E01 | trùng (50% duplicate) | bỏ, hội tụ |
| E02 | gap (mất một COMMIT) | STATE_REQUEST, snapshot, hội tụ |
| E03 | term cũ | bỏ |
| E04 | term tương lai | freeze, rồi hội tụ một lịch sử |
| E05 | senderId giả | DROP_SPOOF |
| E06 | client gửi score/winner | bỏ qua |

## D. Host migration
| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| H01 | Host rớt | mọi người MIGRATING |
| H02 | ứng viên deterministic | p2; nếu p2 cũng chết ⇒ p3 |
| H03 | đủ quorum | Host mới, term 1, chơi tiếp |
| H04 | không quorum | không leader, term vẫn 0 (pre-vote) |
| H05 | Host cũ quay lại | peer thường |
| H06 | commit term cũ | bỏ |
| H07 | Host chết ngay sau propose | không điểm trùng |
| H07b | Host chết sau quorum ACK, trước COMMIT | điểm được giữ đúng một lần, kể cả ở Host cũ khi quay lại |
| H08 | Host chết sau commit tới một peer | state đã commit được giữ |
| H09 | chia mạng 2/3 | thiểu số không tiến; đa số bầu p3, chơi tiếp; nối lại hội tụ |
| H10 | Host chết lúc đếm ngược | Host mới đếm lại, vào PLAYING |
| H10b | Host chết sau propose GAME_STARTED | trận vẫn bắt đầu với Host mới |
| + | link bất đối xứng | không hất Host khoẻ |

## E. Reconnect
| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| R01/R02/R03 | người chơi rớt rồi nối lại, lỡ 3 event | cùng id/joinSequence, snapshot, hội tụ |
| R04 | hash snapshot sai ×3 | DESYNC, khoá input, phục hồi bằng snapshot đúng |
| R04b | state cục bộ hỏng | phát hiện qua heartbeat hash, sửa bằng snapshot |
| R05 | Host quay lại sau migrate | không giành lại quyền |
| reload | tab reload, restore từ storage | cùng slot (sim + e2e) |

## F. WebRTC / QR — `qr.test.ts`, `e2e/game.spec.ts`
| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| W01 | offer QR | hợp lệ (URL / fragment / chuỗi), < 1200 ký tự |
| W02 | answer QR | hợp lệ |
| W03 | sai phòng / sai host / sai nonce | reject |
| W04 | hết hạn (đồng hồ bên mời) | reject |
| W05 | link trùng | chỉ joinSequence thấp hơn được dial; link mới thay link cũ |
| W06 | mesh | Start chỉ khi full mesh; e2e 3 người nối B↔C qua relay |
| W07 | mất kết nối tạm (2.5 s) | không migrate |
| W08 | link failed | bầu nhanh (< 4.5 s) |
| e2e | QR → mesh → chơi → đóng tab Host → bầu → chơi tiếp | pass trên Chromium thật |
| e2e | reload giữa trận → rejoin QR từ thành viên | cùng slot/điểm, mesh tự sửa, ghi điểm tiếp |

## G. Trust boundary
| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| S01 | giả senderId | reject |
| S02/S03 | non-Host propose / commit / snapshot | bỏ |
| S04 | Host propose target giả | không ai ACK |
| S04b | certificate thiếu quorum | bỏ |
| S05 | Host cũ | bỏ |
| S06/S07 | term sai kiểu, protocol sai, JSON hỏng, > 64 KB | drop an toàn, game vẫn chạy |

## Stress — `stress.test.ts`

8 người · bot bấm trong cùng cửa sổ 100 ms · drop 5–10% · latency 100–300 ms · duplicate 5% · reorder (1/3 seed) · kill Host định kỳ (kể cả ngay sau propose/commit) · kill follower · nhiều người reload & vào lại cùng lúc. Mỗi 50 ms kiểm: invariants trên mọi peer, và **SafetyMonitor**: hai peer bất kỳ ở cùng `(round, logIndex)` phải có cùng `stateHash`. Sau khi mạng lành: hội tụ, đúng một leader, ghi thêm 3 điểm được.

Mặc định 6 seed trong CI; đã chạy 300 seed không vi phạm (`STRESS_SEEDS=300`). Hai bug thật được stress tìm ra trong quá trình implement: A8 và A9 trong `00-review.md`.
