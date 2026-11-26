import React, { useState } from 'react';
import {
  CheckCircle2,
  DatabaseBackup,
  FileCheck2,
  HardDrive,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient';
import type { TerminalSnapshot } from '../types/terminal';

interface QaArchitecturePanelProps {
  snapshot: TerminalSnapshot;
  onRefreshState: (next: TerminalSnapshot) => void;
}

const ANALYSIS_MATRIX = [
  {
    stt: 1,
    screen: 'Thanh tiêu đề & Chỉ số KPI',
    module: 'HeaderBar',
    fn: 'Hiển thị trạng thái, thời gian chạy, giá SOL, độ trễ RPC, Số dư ảo & Ví Phantom (Non-Custodial / Watch-Only) tách biệt',
    input: 'SQLite SystemSettings + Solana RPC getSlot + DexScreener SOL',
    output: 'Số dư ảo ($), Lệnh dương/âm, kết nối Phantom độc lập',
    level: 'Quan sát trực tiếp + API thật',
  },
  {
    stt: 2,
    screen: 'Thanh bên 10 Agent & Trợ lý YOU',
    module: 'AgentsSidebar + AgentInspectorModal',
    fn: 'Hiển thị 10 Agent đúng thứ tự & khu vực YOU, nhấn để xem nhật ký/lỗi/chỉ số từng Agent',
    input: 'SQLite Agents, Notifications, SystemLogs',
    output: 'Trạng thái SCAN/TRACK/READ/AUDIT/MAP/IDLE/LIVE/LADDER/ARMED/ACTIVE',
    level: 'Quan sát trực tiếp + Suy luận',
  },
  {
    stt: 3,
    screen: 'Luồng trực tiếp & Sơ đồ trung tâm',
    module: 'LiveFlowWorkspace',
    fn: 'Luồng token trượt ngang, sơ đồ Kiểm toán LP -> Lõi Grok -> Sniper mô phỏng',
    input: 'DexScreener Solana trực tiếp + Solana RPC getAccountInfo (Mint/Freeze)',
    output: 'Lọc rủi ro tự động, cập nhật luồng xử lý',
    level: 'Quan sát trực tiếp + Xử lý thật',
  },
  {
    stt: 4,
    screen: 'Chi tiết lệnh + Phiên + Tài sản + Nhật ký',
    module: 'PaperTradingEngine',
    fn: 'Mô phỏng MUA/BÁN/CẮT LỖ trên vốn ảo, tính Tỷ lệ thắng, Hệ số tốt nhất, Biểu đồ tài sản',
    input: 'SQLite PaperTrades, EquityHistory, SystemLogs',
    output: 'Biểu đồ Tài sản & Lịch sử Recharts tương tác, xuất file CSV',
    level: 'Quan sát trực tiếp + DB thật',
  },
  {
    stt: 5,
    screen: 'Phantom & Jupiter DEX',
    module: 'UnifiedPhantomDexWorkspace + PhantomPairMobilePage',
    fn: 'Kết nối Phantom Extension (Non-Custodial ký swap/transfer trên ví người dùng), mã QR di động dùng 1 lần (32-hex, 5 phút), đọc SOL & SPL/Token-2022',
    input: 'Địa chỉ Base58 công khai + Báo giá Jupiter v1 -> Solana Mainnet JSON-RPC',
    output: 'Số dư thực tế & Giao dịch ký trực tiếp trên Phantom (tách biệt vốn mô phỏng)',
    level: 'Bổ sung theo đặc tả Phần 9 & 10',
  },
  {
    stt: 6,
    screen: 'Kiểm thử dữ liệu thật (Backtest)',
    module: 'BacktestEngine',
    fn: 'Tải nến OHLCV thật từ GeckoTerminal, tạo SHA-256 Hash, kiểm định chất lượng & chạy chống Look-ahead',
    input: 'Địa chỉ Pool Solana + khung nến + cấu hình Stop/TP/Trail',
    output: 'Danh mục dữ liệu, Lợi nhuận %, Sụt giảm tối đa %, bảng lệnh tái lập',
    level: 'Bổ sung theo đặc tả Phần 13',
  },
];

export const QaArchitecturePanel: React.FC<QaArchitecturePanelProps> = ({
  snapshot,
  onRefreshState,
}) => {
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCreateBackup = async () => {
    setBusy(true);
    setBackupMsg(null);
    try {
      const res = await apiFetch('/api/backup/create', { method: 'POST' });
      const data = (await res.json()) as {
        ok?: boolean;
        fileName?: string;
        snapshot?: TerminalSnapshot;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.snapshot) {
        throw new Error(data.error || 'Sao lưu thất bại');
      }
      onRefreshState(data.snapshot);
      setBackupMsg(`Đã sao lưu SQLite thành công: data/backups/${data.fileName}`);
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : 'Lỗi sao lưu');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Honest Environment & Safety Verification */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#43D7B1]/50 bg-[#06231F] p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#43D7B1]">
            <ShieldCheck className="h-4 w-4" />
            KIỂM ĐỊNH BẢO MẬT & KIẾN TRÚC AN TOÀN (PHẦN 19)
          </div>
          <ul className="space-y-1.5 text-xs text-[#E6F2ED]">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#39DEA2] shrink-0" />
              Kiến trúc Non-Custodial: Ký giao dịch thực tế qua Jupiter DEX chỉ thực hiện trực tiếp trong Ví Phantom của người dùng, không lưu Private Key trên server.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#39DEA2] shrink-0" />
              Từ chối đầu vào giống Seed Phrase (12-24 từ) hoặc Private Key tại mọi API kết nối ví.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#39DEA2] shrink-0" />
              Market Scanner tự động vẫn giữ chế độ Chỉ đọc, chặn mọi payload chứa trường giao dịch thực thi trái phép.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#39DEA2] shrink-0" />
              Cổng xác thực Bearer Token bắt buộc (scrypt + timingSafeEqual) bảo vệ toàn bộ API và chống tự ý sửa lãi/lỗ mô phỏng từ phía client.
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#39DEA2] shrink-0" />
              Toàn bộ truy vấn SQLite (bao gồm bảng LiveTrades on-chain) dùng tham số hóa (Prepared Statements), lưu tại data/grok_bot_terminal.db.
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-[#49A9ED]/50 bg-[#06231F] p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#49A9ED]">
              <HardDrive className="h-4 w-4" />
              TRẠNG THÁI MÔI TRƯỜNG & SAO LƯU SQLITE
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleCreateBackup}
              className="inline-flex items-center gap-1.5 rounded border border-[#43D7B1]/60 bg-[#092D27] px-2.5 py-1 text-xs font-semibold text-[#43D7B1] hover:bg-[#145B4B]/60 cursor-pointer"
            >
              <DatabaseBackup className="h-3.5 w-3.5" />
              Tạo Backup SQLite
            </button>
          </div>
          <p className="text-xs text-[#8FA9A0] leading-relaxed">
            Ứng dụng đang vận hành thực tế trên nền tảng Web/Node.js Full-Stack (React 19 + TypeScript + Express + SQLite) với kết nối Solana Mainnet RPC, DexScreener & GeckoTerminal OHLCV thật.
          </p>
          <p className="text-xs text-[#EAC64D] leading-relaxed">
            Lưu ý trung thực (Phần 22): Môi trường lập trình Linux container hiện tại không có Hyper-V/VMware và bộ biên dịch Windows Desktop WPF/MSIX (.exe), nên giai đoạn cài đặt máy ảo Windows 11 & đóng gói Setup.exe chưa thể thực thi trực tiếp tại đây và cần chạy trên máy host Windows 11.
          </p>
          {backupMsg && (
            <div className="rounded border border-[#39DEA2]/50 bg-[#39DEA2]/10 px-2.5 py-1.5 font-mono-tabular text-[11px] text-[#39DEA2]">
              {backupMsg}
            </div>
          )}
        </div>
      </div>

      {/* Section 3.3 Analysis Matrix */}
      <div className="rounded-xl border border-[#145B4B] bg-[#06231F] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#E6F2ED]">
            <FileCheck2 className="h-4 w-4 text-[#FF9B45]" />
            BẢNG PHÂN TÍCH NGHIỆP VỤ & KIẾN TRÚC MODULE (PHẦN 3.3)
          </div>
          <span className="font-mono-tabular text-xs text-[#8FA9A0]">
            {snapshot.agents.length} Agent · {snapshot.trades.length} Lệnh mô phỏng · {snapshot.backtestSessions.length} Lần kiểm thử
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-[#145B4B]/70 bg-[#031713]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#092D27] text-[11px] text-[#43D7B1]">
              <tr>
                <th className="px-3 py-2">STT</th>
                <th className="px-3 py-2">Màn hình / Khu vực</th>
                <th className="px-3 py-2">Module</th>
                <th className="px-3 py-2">Chức năng</th>
                <th className="px-3 py-2">Đầu vào</th>
                <th className="px-3 py-2">Đầu ra</th>
                <th className="px-3 py-2">Mức độ xác định</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#145B4B]/40">
              {ANALYSIS_MATRIX.map((row) => (
                <tr key={row.stt} className="hover:bg-[#092D27]/40">
                  <td className="px-3 py-2.5 font-mono-tabular text-[#8FA9A0]">{row.stt}</td>
                  <td className="px-3 py-2.5 font-semibold text-[#E6F2ED]">{row.screen}</td>
                  <td className="px-3 py-2.5 font-mono-tabular text-[#FF9B45]">{row.module}</td>
                  <td className="px-3 py-2.5 text-[#E6F2ED]">{row.fn}</td>
                  <td className="px-3 py-2.5 text-[#8FA9A0]">{row.input}</td>
                  <td className="px-3 py-2.5 text-[#8FA9A0]">{row.output}</td>
                  <td className="px-3 py-2.5 font-mono-tabular text-[#39DEA2]">{row.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
