"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  Clock3,
  RefreshCw,
  Wallet,
  Percent,
  IndianRupee,
  Gift,
  Download,
  MessageSquare,
  Mic,
  RotateCw,
  Target,
  Image as ImageIcon,
  Volume2,
} from "lucide-react";

const PLATFORM_FEE = 0.10;

const transactions = [
  {
    date: "21 Oct 2026 09:42 PM",
    supporter: "Rohan",
    interaction: "Text",
    amount: 100,
    icon: MessageSquare,
  },
  {
    date: "21 Oct 2026 07:18 PM",
    supporter: "Priya",
    interaction: "Voice Message",
    amount: 200,
    icon: Mic,
  },
  {
    date: "20 Oct 2026 11:03 PM",
    supporter: "Aman",
    interaction: "Spin Wheel",
    amount: 150,
    icon: RotateCw,
  },
  {
    date: "20 Oct 2026 08:21 PM",
    supporter: "Karan",
    interaction: "Task",
    amount: 50,
    icon: Target,
  },
  {
    date: "19 Oct 2026 06:14 PM",
    supporter: "Neha",
    interaction: "Stickers",
    amount: 120,
    icon: ImageIcon,
  },
  {
    date: "19 Oct 2026 04:52 PM",
    supporter: "Dev",
    interaction: "Soundboard",
    amount: 80,
    icon: Volume2,
  },
  {
    date: "18 Oct 2026 09:11 PM",
    supporter: "Simran",
    interaction: "Text",
    amount: 100,
    icon: MessageSquare,
  },
  {
    date: "18 Oct 2026 05:37 PM",
    supporter: "Rahul",
    interaction: "Spin Wheel",
    amount: 250,
    icon: RotateCw,
  },
];

function money(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

export default function EarningsPage() {
  const [cycle, setCycle] = useState<"current" | "previous">("current");

  const currentStart = new Date("2026-10-07T00:00:00");
  const currentEnd = new Date("2026-10-21T23:59:59");

  const today = new Date();

  const totalEarnings = useMemo(
    () => transactions.reduce((sum, item) => sum + item.amount, 0),
    []
  );

  const platformFee = Math.round(totalEarnings * PLATFORM_FEE);
  const creatorReceive = totalEarnings - platformFee;

  const dayNumber = Math.min(
    15,
    Math.max(
      1,
      Math.floor(
        (today.getTime() - currentStart.getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1
    )
  );

  const progress = (dayNumber / 15) * 100;

  return (
    <div className="min-h-screen bg-[#080d1d] text-white">
      <div className="p-5 lg:p-8">

        {/* HEADER */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Earnings
            </h1>

            <p className="mt-1 text-sm text-slate-400">
              Track your earnings, fees and 15-day payout cycles.
            </p>
          </div>

          <button className="flex items-center gap-2 rounded-xl border border-slate-700 bg-[#111827] px-4 py-3 text-sm text-slate-200">
            <CalendarDays size={17} />
            Oct 7, 2026 - Oct 21, 2026
          </button>
        </div>

        {/* 15 DAY CYCLE */}
        <div className="mt-7 overflow-hidden rounded-2xl border border-indigo-500/50 bg-gradient-to-r from-[#111a35] via-[#11182f] to-[#181238] p-5 shadow-[0_0_35px_rgba(91,139,255,0.08)]">

          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">

            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600/30">
                <CalendarDays className="text-blue-400" size={28} />
              </div>

              <div>
                <p className="text-lg font-semibold">
                  Current 15-Day Cycle
                </p>

                <p className="text-sm text-slate-400">
                  Your earnings for the current cycle
                </p>
              </div>
            </div>

            <div className="text-center">
              <p className="font-semibold">
                Oct 7, 2026 - Oct 21, 2026
              </p>

              <p className="mt-1 text-sm text-slate-400">
                15 days · Day {dayNumber} of 15
              </p>

              <div className="mt-3 h-2 w-64 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#5B8BFF] to-[#7C3AED]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                <Clock3 size={16} />
                Next cycle
              </div>

              <p className="mt-1 text-xl font-bold">
                22 Oct 2026
              </p>

              <button
                className="mt-2 flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#5B8BFF] to-[#7C3AED] px-4 py-2 text-sm font-semibold"
                onClick={() => setCycle("current")}
              >
                <RefreshCw size={15} />
                Renew Cycle
              </button>
            </div>

          </div>
        </div>

        {/* STATS */}
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-4">

          <StatCard
            title="Total Earnings"
            value={money(totalEarnings)}
            subtitle="Total amount paid by viewers"
            icon={<Wallet size={25} />}
            className="from-emerald-950/70 to-[#102b2a]"
          />

          <StatCard
            title="Live Lounge Fee"
            value={money(platformFee)}
            subtitle="Platform fee (10% cut)"
            icon={<Percent size={25} />}
            badge="10%"
            className="from-rose-950/70 to-[#291525]"
          />

          <StatCard
            title="You Receive"
            value={money(creatorReceive)}
            subtitle="Amount after 10% fee"
            icon={<IndianRupee size={25} />}
            className="from-indigo-950/70 to-[#17133a]"
          />

          <StatCard
            title="Total Supports"
            value={transactions.length.toString()}
            subtitle="Successful interactions"
            icon={<Gift size={25} />}
            className="from-blue-950/70 to-[#10243c]"
          />

        </div>

        {/* CHART + BREAKDOWN */}
        <div className="mt-6 grid gap-5 xl:grid-cols-3">

          <div className="rounded-2xl border border-slate-800 bg-[#0e172b] p-5 xl:col-span-2">

            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  Earnings Overview
                  <span className="ml-2 text-indigo-300">
                    (Current 15 Days)
                  </span>
                </h2>

                <p className="mt-1 text-sm text-slate-400">
                  Daily earnings from Oct 7 - Oct 21, 2026
                </p>
              </div>

              <div className="hidden gap-4 text-xs sm:flex">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                  Total Earnings
                </span>

                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-purple-500" />
                  You Receive (90%)
                </span>
              </div>
            </div>

            {/* SIMPLE BAR CHART */}
            <div className="mt-8 flex h-56 items-end justify-between gap-2 border-b border-slate-700 px-2">

              {[35, 28, 42, 50, 36, 48, 52, 70, 56, 75, 51, 45, 58, 72, 64].map(
                (height, index) => (
                  <div
                    key={index}
                    className="flex h-full flex-1 items-end justify-center gap-1"
                  >
                    <div
                      className="w-2 rounded-t bg-blue-500"
                      style={{ height: `${height}%` }}
                    />

                    <div
                      className="w-2 rounded-t bg-purple-500"
                      style={{ height: `${height * 0.75}%` }}
                    />
                  </div>
                )
              )}

            </div>

            <div className="mt-3 flex justify-between text-[11px] text-slate-500">
              <span>Oct 7</span>
              <span>Oct 9</span>
              <span>Oct 11</span>
              <span>Oct 13</span>
              <span>Oct 15</span>
              <span>Oct 17</span>
              <span>Oct 19</span>
              <span>Oct 21</span>
            </div>
          </div>

          {/* BREAKDOWN */}
          <div className="rounded-2xl border border-slate-800 bg-[#0e172b] p-5">

            <h2 className="text-lg font-bold">
              Earnings Breakdown
            </h2>

            <p className="text-sm text-indigo-300">
              Current Cycle
            </p>

            <div className="mt-7 flex items-center justify-center">

              <div className="relative flex h-44 w-44 items-center justify-center rounded-full bg-[conic-gradient(#5B8BFF_0deg_324deg,#ec4899_324deg_360deg)]">
                <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-[#0e172b]">
                  <span className="text-xl font-bold">
                    {money(totalEarnings)}
                  </span>
                  <span className="text-xs text-slate-400">
                    Total
                  </span>
                </div>
              </div>

            </div>

            <div className="mt-7 space-y-5">

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-blue-500" />
                  <span className="text-sm">
                    You Receive (90%)
                  </span>
                </div>

                <span className="font-bold">
                  {money(creatorReceive)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 rounded-full bg-pink-500" />
                  <span className="text-sm">
                    Live Lounge Fee (10%)
                  </span>
                </div>

                <span className="font-bold">
                  {money(platformFee)}
                </span>
              </div>

            </div>
          </div>
        </div>

        {/* TRANSACTIONS */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-[#0e172b]">

          <div className="flex flex-col gap-4 border-b border-slate-800 p-5 md:flex-row md:items-center md:justify-between">

            <div>
              <h2 className="text-xl font-bold">
                Recent Interactions
                <span className="ml-2 text-indigo-300">
                  (Oct 7 - Oct 21, 2026)
                </span>
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                Latest support received in the current 15-day cycle
              </p>
            </div>

            <button className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">
              <Download size={16} />
              Export
            </button>

          </div>

          <div className="overflow-x-auto">

            <table className="w-full min-w-[900px] text-sm">

              <thead className="bg-[#111e38] text-slate-300">
                <tr>
                  <th className="px-5 py-4 text-left">#</th>
                  <th className="px-5 py-4 text-left">Date & Time</th>
                  <th className="px-5 py-4 text-left">Supporter</th>
                  <th className="px-5 py-4 text-left">Interaction</th>
                  <th className="px-5 py-4 text-left">Amount</th>
                  <th className="px-5 py-4 text-left">
                    Live Lounge Fee (10%)
                  </th>
                  <th className="px-5 py-4 text-left">You Receive</th>
                  <th className="px-5 py-4 text-left">Status</th>
                </tr>
              </thead>

              <tbody>
                {transactions.map((item, index) => {
                  const fee = Math.round(item.amount * PLATFORM_FEE);
                  const receive = item.amount - fee;
                  const Icon = item.icon;

                  return (
                    <tr
                      key={index}
                      className="border-t border-slate-800 hover:bg-white/[0.02]"
                    >
                      <td className="px-5 py-4 text-slate-500">
                        {index + 1}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        {item.date}
                      </td>

                      <td className="px-5 py-4 font-medium">
                        {item.supporter}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-300">
                            <Icon size={16} />
                          </span>
                          {item.interaction}
                        </div>
                      </td>

                      <td className="px-5 py-4 font-semibold">
                        {money(item.amount)}
                      </td>

                      <td className="px-5 py-4 text-rose-300">
                        {money(fee)}
                      </td>

                      <td className="px-5 py-4 font-semibold text-emerald-400">
                        {money(receive)}
                      </td>

                      <td className="px-5 py-4">
                        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
                          Completed
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

            </table>
          </div>
        </div>

      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  badge,
  className,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  badge?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br ${className} p-5`}
    >
      <div className="flex items-start justify-between">

        <div>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            {title}

            {badge && (
              <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">
                {badge}
              </span>
            )}
          </div>

          <p className="mt-2 text-3xl font-bold">
            {value}
          </p>

          <p className="mt-1 text-xs text-slate-400">
            {subtitle}
          </p>
        </div>

        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
          {icon}
        </div>

      </div>
    </div>
  );
}