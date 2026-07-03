# Split Bill dApp — Product Spec

Nền tảng: Arc Testnet (Circle). Thanh toán: USDC. Cross-chain: CCTP V2.

---

## 1. Tổng quan sản phẩm

**App là gì:** Chia hóa đơn nhóm bằng USDC trên Arc. Thanh toán diễn ra on-chain, minh bạch, verify bằng hash giao dịch — không cần tin lời nhau. Hỗ trợ người trả từ các chain khác qua CCTP V2 thật (burn & mint), không cần tự bridge tay trước khi vào app.

**Tagline:** _"Chia bill nhóm có người ở nhiều chain — trả thẳng không cần nhờ ai trả hộ, và ai trả gì đều minh bạch, kiểm tra được."_

**Vấn đề giải quyết:** Nhóm có người sở hữu USDC ở nhiều chain khác nhau. Cách làm hiện tại: nhờ 1 người trả hết, người khác chuyển lại tiền mặt/ngân hàng sau — dễ quên, không có bằng chứng khi có tranh cãi ai đã trả ai chưa.

**Ai dùng:**

- Hiện tại: nhóm bạn builder của bạn, dùng thật trên Arc Testnet (không chỉ demo cho giám khảo).
- Tương lai (nếu mainnet): ai muốn chia bill minh bạch mà không cần khai báo danh tính thật — verify chỉ cần nhìn hash on-chain, khác với ngân hàng yêu cầu CMND/passport.

**Không làm gì (out of scope):**

- Không giữ tiền dài hạn (no custody/escrow) — xem mục 7 về 1 ngoại lệ kỹ thuật atomic.
- Không có cơ chế trọng tài/dispute resolution — nếu organizer chia sai/thu dư, app không can thiệp, chỉ cung cấp bằng chứng minh bạch để nhóm tự xử.
- Không KYC, không thu thập danh tính thật.
- Không chạy mainnet/xử lý tiền thật ở giai đoạn này — chỉ Arc Testnet.

---

## 2. Hai cách tạo bill

|                          | Cách 1 — Assigned                                          | Cách 2 — Open-slot (giống QR cửa hàng/ngân hàng)                                                                                                                |
| ------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input lúc tạo            | Danh sách người + wallet cụ thể                            | Tổng tiền + số người N                                                                                                                                          |
| Share                    | Gắn cứng 1 wallet/người, chia đều hoặc tùy chỉnh           | Tổng/N, không gắn người cụ thể trước                                                                                                                            |
| Link/QR                  | 1 link chung, mỗi người connect đúng wallet thấy phần mình | 1 link/QR dùng chung, ai cầm cũng trả được                                                                                                                      |
| 1 wallet trả nhiều phần? | Không — 1 wallet = 1 share cố định                         | Được — trả giúp người vắng mặt                                                                                                                                  |
| Giới hạn nhận            | Đúng share đã định, không dư/thiếu                         | **Không giới hạn cứng** — hoạt động như 1 tài khoản nhận tiền bình thường, ai gửi vẫn vào được kể cả sau khi đủ N                                               |
| Hiển thị trạng thái      | Tick xanh (đã trả) / đỏ (chưa trả) theo từng tên           | "X/N đã trả" — đếm các khoản đúng `amountPerSlot`; tiền gửi sai số hoặc gửi thêm sau khi đủ N vẫn được nhận, cộng vào phần dư cho organizer, không tính vào X/N |

> Dòng cuối bảng (đếm X/N chỉ tính khoản đúng số tiền) là cách dung hòa 2 yêu cầu "không giới hạn cứng" và "hiển thị tiến độ X/N" — đề xuất này cần được xác nhận hoặc sửa lại nếu không đúng ý.

**Tạo bill xong là immutable** — không sửa được tổng tiền/danh sách sau khi tạo, có sai thì tạo bill mới.

---

## 3. Luồng sử dụng

**Tạo bill:** Organizer chọn Cách 1 hoặc Cách 2 → điền thông tin → hệ thống tạo bill on-chain + sinh link/QR.

**Trả tiền (cả 2 cách):**

1. Người trả mở link → thấy số tiền cần trả → chọn chain đang có USDC.
2. **Đã có USDC trên Arc:** gọi trực tiếp hàm trả, xong ngay.
3. **Chưa có, cần cross-chain:** hệ thống check balance trên chain đã chọn trước khi cho ký (chặn lỗi sớm) → ký `depositForBurn` (kèm hookData) → đợi attestation (8–20s, Fast Transfer) → gọi tiếp Bill.payCrossChain(message, attestation) trên Arc (ai cũng gọi được — chính người trả tự gọi, hoặc 1 relayer tự động ở phase sau) → trong đúng 1 transaction: mint USDC + decode + ghi nhận thanh toán + forward tiền cho organizer.
4. Nếu đóng tab giữa lúc đợi attestation: trạng thái pending được lưu, mở lại app sẽ nhắc ký tiếp bước `receiveMessage`, không cần làm lại từ đầu.
5. Nếu Circle tạm dừng attestation (circuit breaker — hiếm, chưa từng xảy ra exploit/pause tính đến giờ): hiển thị "đang xử lý lâu hơn bình thường, tiền không mất, đang chờ xử lý."

**Theo dõi:** Ai cũng xem được bill qua link, không cần đăng nhập, không cần khai danh tính — chỉ verify bằng hash. Cách 1 hiện danh sách tick xanh/đỏ. Cách 2 hiện "X/N đã trả" + danh sách wallet đã trả hiện dần.

**Whitelist (tiện ích riêng của organizer):** Mỗi organizer có whitelist ví riêng (không chia sẻ, không công khai) để autofill khi tạo bill mới — gắn tên gợi nhớ chỉ organizer thấy. Không dùng để giới hạn truy cập — ai có link vẫn trả được dù không có trong whitelist.

---

## 4. Vai trò QR

QR **không phải** kiểu "địa chỉ + số tiền" như QR ngân hàng, vì 1 mã không đủ chứa thông tin cho nhiều chain khác nhau. QR mã hoá **link tới trang trả tiền của bill**. Quét QR = mở trang trên điện thoại, từ đó người trả mới chọn chain và ký thật qua kết nối wallet trên trang (không qua raw payment URI cho phần cross-chain).

Riêng đường trả trực tiếp trên Arc (không cross-chain), QR có thể nhúng thêm payment URI chuẩn (giống QR ngân hàng — quét xong tự điền số tiền) vì đây chỉ là 1 giao dịch USDC đơn giản trên 1 chain.

---

## 5. Data model & kiến trúc contract

```solidity
enum BillMode { ASSIGNED, OPEN_SLOT }

struct Bill {
    address organizer;        // nơi tiền cuối cùng về
    BillMode mode;
    uint256 totalAmount;
    // ASSIGNED mode
    mapping(uint256 => Share) shares;
    uint256 shareCount;
    // OPEN_SLOT mode
    uint256 amountPerSlot;
    uint256 numSlots;
    uint256 matchedSlotsCount;     // chỉ để hiển thị "X/N", không chặn gì
    uint256 extraReceived;         // tiền sai số/dư sau khi đủ N, cộng cho organizer
}

struct Share {
    address assignedWallet;
    uint256 amount;
    bool paid;
}
```

**Hai đường thanh toán:**

- **Trực tiếp trên Arc:** gọi hàm `pay()` tương ứng mode, dùng `transferFrom(msg.sender, organizer, amount)` — tiền đi thẳng từ người trả đến organizer, **không chạm vào contract**, không có gì để custody.
- **Cross-chain qua CCTP Hook:** xem mục 6 — có 1 điểm cần lưu ý về custody tạm thời, khác với đường trực tiếp.

---

## 6. Cơ chế CCTP Hook (kỹ thuật, áp dụng cho cả 2 mode)

> **Lưu ý kiến trúc quan trọng:** CCTP V2 không tự thực thi hook — `hookData` chỉ là
> metadata "mù" đính kèm message, theo docs chính thức Circle
> (`developers.circle.com/cctp/technical-guide`). Không có cơ chế callback tự động
> từ `MessageTransmitterV2`/`TokenMessengerV2` tới `mintRecipient`. Bill contract
> phải **tự chủ động gọi** `receiveMessage`, không phải "implement interface rồi
> chờ CCTP gọi tới".

`BurnMessageV2` của CCTP V2 mang theo `messageSender` (ví đã gọi `depositForBurn` ở
chain nguồn) + `amount`, được Circle attest — không giả mạo được. Người trả encode
`billId` (+ `shareId` nếu Assigned mode) vào `hookData` lúc gọi `depositForBurnWithHook`.

`mintRecipient` của giao dịch CCTP đặt là địa chỉ contract `Bill` — không phải vì
CCTP sẽ "gọi vào" nó, mà đơn giản đây là nơi USDC được mint tới, để bước forward
tiền (dòng cuối hàm dưới đây) xảy ra ngay trong cùng transaction, không cần thêm
bước chuyển riêng.

```solidity
/// @notice Ai cũng gọi được — tương đương cách bất kỳ ai cũng gọi được
///         MessageTransmitterV2.receiveMessage() vốn permissionless.
function payCrossChain(bytes calldata message, bytes calldata attestation) external {
    bool ok = messageTransmitter.receiveMessage(message, attestation);
    require(ok, "receiveMessage failed");

    // Tự decode message theo byte offset đã verify ở Phase 1 (BurnMessageV2)
    uint256 amount        = _readUint256(message, OFFSET_AMOUNT);
    bytes32 messageSender = _readBytes32(message, OFFSET_MESSAGE_SENDER);
    bytes memory hookData = message[OFFSET_HOOK_DATA:];

    if (bill.mode == BillMode.ASSIGNED) {
        (uint256 billId, uint256 shareId) = abi.decode(hookData, (uint256, uint256));
        Share storage share = bills[billId].shares[shareId];
        require(!share.paid, "already paid");
        require(address(uint160(uint256(messageSender))) == share.assignedWallet, "wrong wallet");
        require(amount == share.amount, "wrong amount");
        share.paid = true;
        usdc.transfer(bills[billId].organizer, amount); // forward ngay trong cùng tx
    } else {
        uint256 billId = abi.decode(hookData, (uint256));
        if (amount == bills[billId].amountPerSlot) {
            bills[billId].matchedSlotsCount++;
        } else {
            bills[billId].extraReceived += amount;
        }
        usdc.transfer(bills[billId].organizer, amount);
    }
}
```

Vì `receiveMessage` + decode + forward nằm trong cùng 1 hàm, cùng 1 transaction —
vẫn giữ đúng tinh thần "no custody" đã chốt, chỉ khác _cơ chế kích hoạt_: Bill
contract **chủ động gọi**, không phải bị động "chờ hook fire".

**Chống double-spend:** `MessageTransmitter` tự track nonce theo bitmap, 1 message
chỉ xử lý đúng 1 lần — không cần code thêm. Tuy nhiên, nonce KHÔNG chặn được trường
hợp 2 burn riêng biệt (2 nonce khác nhau) cùng trỏ vào 1 billId/shareId —
`AlreadyPaid` (check `!share.paid` ở trên) là lớp bảo vệ duy nhất cho case này,
bắt buộc có ở Phase 3.

## 7. Thông tin kỹ thuật Arc/CCTP đã xác nhận

| Field                | Value                                        |
| -------------------- | -------------------------------------------- |
| Network              | Arc Testnet                                  |
| Chain ID             | `5042002`                                    |
| RPC                  | `https://rpc.testnet.arc.network`            |
| Explorer             | `https://testnet.arcscan.app`                |
| Faucet               | `https://faucet.circle.com`                  |
| USDC address         | `0x3600000000000000000000000000000000000000` |
| CCTP Domain (Arc)    | `26`                                         |
| Gas native decimals  | 18                                           |
| USDC ERC-20 decimals | 6                                            |

- Chỉ dùng **CCTP V2** (V1 Legacy phase-out từ 31/7/2026, không build trên V1).
- Dùng **Fast Transfer** (`minFinalityThreshold ≤ 500`) — ưu tiên tốc độ 8–20s hơn phí nhỏ.
- "Tất cả các chain" = tất cả chain CCTP V2 hỗ trợ làm source (~13+: Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, Solana, Linea, Unichain, Sonic, World Chain, Sei...), danh sách tăng dần, không phải mọi chain tồn tại.
- Tài nguyên free/chính thức: `github.com/circlefin/skills` (skill `bridge-stablecoin`), `docs.arc.network/llms.txt`, `developers.circle.com`.

---

## 8. Rủi ro đã biết, chấp nhận theo đúng tinh thần Web3

- Contract chưa audit — chấp nhận khi test với nhóm bạn (tiền test, không phải tiền thật).
- Mất private key của organizer giữa lúc bill đang chạy — không thêm cơ chế (rủi ro Web3 vốn có).
- Link bị share ra ngoài nhóm — chấp nhận, đúng tinh thần minh bạch.
- Giả mạo link/UI lừa đảo — xử lý qua kênh riêng (DM/nhóm chat), ngoài phạm vi app.
- Circle tạm pause CCTP (circuit breaker) — cực hiếm, chỉ cần 1 dòng thông báo, không cần xử lý sâu.

---

## 9. Roadmap build — 7 Phase

1. **CCTP Hook riêng** — test decode/validate/reject, tách biệt khỏi Bill thật (rủi ro nhất, làm trước). Chạy được khi: burn thật từ Base Sepolia → Arc Testnet thành công (đã làm, có tx hash thật trên cả 2 chain); forge test dùng raw message body thật (copy từ tx thật, không phải dữ liệu giả lập) gọi decode logic qua vm.prank, xác nhận decode đúng messageSender+amount+hookData theo offset đã verify; pass case đúng / reject case sai.
2. **Bill contract lõi**, chỉ trả trực tiếp trên Arc, cả 2 mode. _Chạy được khi:_ tạo bill, vài wallet đã có USDC trên Arc tự `pay()`, trạng thái đúng.
3. **Gộp Phase 1+2** thành Bill thật, end-to-end 2 đường trả. _Chạy được khi:_ 1 bill, 1 người trả trực tiếp + 1 người trả cross-chain, cả 2 lên đúng trạng thái, không cần gọi tay qua console.
4. **Frontend MVP** (2 chain đã chứng minh). _Chạy được khi:_ tạo bill qua UI, share link, trả bằng 1 trong 2 đường, thấy trạng thái đổi trên UI.
5. **Mở rộng đa chain** + balance check trước khi ký + QR/WalletConnect.
6. **Resume pending** + circuit breaker message + whitelist + faucet helper trong luồng.
7. **Test thật với nhóm bạn builder** trên Arc Testnet.

---

_Spec này tổng hợp từ buổi Product Discovery — mọi quyết định đã qua xác nhận trực tiếp, trừ phần đánh dấu ở mục 2 (cách đếm X/N) là đề xuất cần được xác nhận hoặc sửa lại nếu không đúng ý._
