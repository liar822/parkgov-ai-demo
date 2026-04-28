import React from 'react';
import { ParkingCircle, ShieldCheck } from 'lucide-react';

const capabilityLabels = ['车位感知', '分流推荐', '治理研判'];

const sizeClasses = {
  sm: {
    mark: 'h-9 w-9 rounded-lg',
    icon: 'h-5 w-5',
    name: 'text-sm',
    subtitle: 'text-[11px]'
  },
  md: {
    mark: 'h-11 w-11 rounded-xl',
    icon: 'h-6 w-6',
    name: 'text-base',
    subtitle: 'text-xs'
  }
};

const BrandMark = ({
  compact = false,
  inverted = false,
  showSubtitle = true,
  showBadge = false,
  className = '',
  subtitle = 'AI 车位感知与停车诱导治理平台',
  size = 'md'
}) => {
  const sizing = sizeClasses[size] || sizeClasses.md;
  const markClassName = inverted
    ? 'bg-white text-zinc-950 ring-1 ring-white/20'
    : 'bg-zinc-950 text-white';
  const nameClassName = inverted ? 'text-white' : 'text-zinc-950';
  const subtitleClassName = inverted ? 'text-zinc-300' : 'text-zinc-500';

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <div className={`relative flex flex-none items-center justify-center ${sizing.mark} ${markClassName}`}>
        <ParkingCircle className={sizing.icon} />
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
      </div>
      {!compact && (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className={`truncate font-semibold tracking-normal ${sizing.name} ${nameClassName}`}>
              ParkGov AI
            </p>
            {showBadge && (
              <span className="hidden items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 sm:inline-flex">
                <ShieldCheck className="h-3 w-3" />
                北京高校试点
              </span>
            )}
          </div>
          {showSubtitle && (
            <p className={`truncate ${sizing.subtitle} ${subtitleClassName}`}>
              {subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export const CapabilityStrip = ({ inverted = false, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-2 ${className}`}>
    {capabilityLabels.map((label) => (
      <span
        key={label}
        className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
          inverted
            ? 'border-white/15 bg-white/10 text-zinc-100'
            : 'border-zinc-200 bg-white text-zinc-700'
        }`}
      >
        {label}
      </span>
    ))}
  </div>
);

export const PilotBoundaryNote = ({ className = '' }) => (
  <p className={`text-xs leading-5 text-zinc-500 ${className}`}>
    当前为校园试点、公开数据样例与 AI 数据集验证环境，不代表全北京实时摄像头接入。
  </p>
);

export default BrandMark;
