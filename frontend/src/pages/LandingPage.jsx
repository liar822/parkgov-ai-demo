import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Database,
  GitBranch,
  Navigation,
  ParkingCircle,
  ShieldCheck,
  Sparkles,
  Video
} from 'lucide-react';
import BrandMark, { PilotBoundaryNote } from '../components/BrandMark';

const heroLots = [
  { name: 'AI 首选', x: '58%', y: '33%', tone: 'primary', probability: '92%' },
  { name: 'Plan B', x: '73%', y: '55%', tone: 'backup', probability: '86%' },
  { name: '待核验', x: '38%', y: '62%', tone: 'warn', probability: '试点' },
  { name: '可承接', x: '50%', y: '78%', tone: 'backup', probability: '81%' }
];

const valuePillars = [
  {
    title: 'AI 到场保障',
    text: '不是只告诉用户最近，而是先判断“现在过去还稳不稳”，同步给出首选、Plan B 和到场码。',
    icon: ShieldCheck
  },
  {
    title: '识别写回证据链',
    text: '公开数据集训练、校园样例 ROI、推理事件和车位状态写回形成闭环，避免余位只停留在静态展示。',
    icon: Video
  },
  {
    title: '治理分流承接',
    text: '高风险目的地、候选停车资源和可承接备选点一起呈现，支撑校园与城市停车治理试点分析。',
    icon: GitBranch
  }
];

const flowSteps = [
  { label: 'AI 车位感知', detail: '图片/视频 ROI 推理', icon: Bot },
  { label: '余位实时写回', detail: 'inference events 更新车位', icon: Database },
  { label: '到场保障推荐', detail: '首选 + Plan B + 风险', icon: Navigation },
  { label: '治理承接分析', detail: '高压点与候选资源', icon: GitBranch }
];

const metrics = [
  { value: '30k', label: 'CNRPark+EXT 训练样本' },
  { value: '24', label: '校园样例 ROI 验证' },
  { value: '3端', label: '用户 / 管理 / 治理' },
  { value: '0', label: '真实扣款与锁位承诺' }
];

const toneClasses = {
  primary: 'border-emerald-400 bg-emerald-500 text-white shadow-[0_18px_40px_rgba(16,185,129,0.32)]',
  backup: 'border-lime-300 bg-lime-100 text-lime-900 shadow-[0_14px_30px_rgba(132,204,22,0.22)]',
  warn: 'border-amber-300 bg-amber-100 text-amber-900 shadow-[0_14px_30px_rgba(245,158,11,0.20)]'
};

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-[#f7fbf7] text-zinc-950">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandMark
            showBadge
            subtitle="AI 到场保障与停车诱导治理平台"
            className="min-w-0"
          />
          <nav className="hidden items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50/70 p-1 text-sm font-semibold text-zinc-600 md:flex">
            <a href="#assurance" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-800">到场保障</a>
            <a href="#evidence" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-800">AI证据链</a>
            <a href="#governance" className="rounded-full px-3 py-1.5 transition hover:bg-white hover:text-emerald-800">治理承接</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden h-10 items-center rounded-full border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-800 sm:inline-flex"
            >
              登录
            </Link>
            <Link
              to="/parking-lots"
              className="inline-flex h-10 items-center rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(16,185,129,0.22)] transition hover:bg-emerald-700"
            >
              进入停车服务
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-emerald-100 pt-16 sm:min-h-[92vh]">
          <AiParkingScene />
          <div className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] max-w-7xl flex-col justify-center px-4 py-8 sm:min-h-[calc(92vh-4rem)] sm:px-6 sm:py-12 lg:px-8">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-[0_10px_24px_rgba(16,185,129,0.10)] sm:text-sm">
                <Sparkles className="mr-2 h-4 w-4" />
                北京高校停车治理试点 MVP
              </div>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-normal text-zinc-950 sm:mt-6 sm:text-6xl lg:text-7xl">
                AI 已帮你判断：
                <span className="block text-emerald-700">现在去哪停更稳</span>
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-600 sm:mt-6 sm:text-lg sm:leading-8">
                ParkGov AI 把车位感知、余位服务、Plan B 备选和治理承接连成一条演示闭环。用户看到的是停车决策，管理端看到的是 AI 写回证据，治理端看到的是压力承接建议。
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row">
                <Link
                  to="/parking-lots"
                  className="inline-flex h-12 items-center justify-center rounded-full bg-zinc-950 px-6 text-base font-semibold text-white shadow-[0_22px_44px_rgba(15,23,42,0.18)] transition hover:bg-zinc-800"
                >
                  进入 AI 停车服务
                  <Navigation className="ml-2 h-5 w-5" />
                </Link>
                <Link
                  to="/admin/video"
                  className="inline-flex h-12 items-center justify-center rounded-full border border-emerald-200 bg-white/90 px-6 text-base font-semibold text-emerald-800 transition hover:bg-emerald-50"
                >
                  查看 AI 证据链
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </div>
              <div className="mt-6 max-w-2xl rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.06)] sm:mt-8">
                <PilotBoundaryNote className="text-[12px] leading-5 text-zinc-600 sm:text-[13px]" />
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-emerald-100 bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 py-5 sm:grid-cols-4 sm:px-6 lg:px-8">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-3xl bg-[#f7fbf7] px-4 py-4">
                <p className="text-3xl font-semibold text-zinc-950">{metric.value}</p>
                <p className="mt-1 text-sm text-zinc-500">{metric.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="assurance" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold text-emerald-700">AI ARRIVAL ASSURANCE</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-normal text-zinc-950">从“找停车场”升级为“到场是否稳”</h2>
              <p className="mt-4 text-base leading-8 text-zinc-600">
                用户端不再把搜索、筛选、排序作为主任务，而是由 AI 先给出首选、备选、风险和下一步动作。价格透明保留为辅助因素，核心是少绕路、避开满位、及时切换 Plan B。
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {['AI 首选', '可停概率', 'Plan B', 'AI到场码', '外部导航'].map((item) => (
                  <span key={item} className="rounded-full border border-emerald-100 bg-white px-3 py-1.5 text-sm font-semibold text-emerald-800">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {valuePillars.map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <article key={pillar.title} className="rounded-[28px] border border-emerald-100 bg-white p-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-5 text-lg font-semibold text-zinc-950">{pillar.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-zinc-600">{pillar.text}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="evidence" className="bg-zinc-950 py-16 text-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-300">AI EVIDENCE FLOW</p>
                <h2 className="mt-3 max-w-2xl text-4xl font-semibold tracking-normal">识别结果不是静态文案，而是能写回余位的证据链</h2>
              </div>
              <Link
                to="/admin/video"
                className="inline-flex h-11 items-center rounded-full bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-50"
              >
                查看管理端 AI 工作台
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </div>
            <div className="mt-10 grid gap-3 md:grid-cols-4">
              {flowSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <article key={step.label} className="rounded-[28px] border border-white/10 bg-white/[0.06] p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 text-zinc-950">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="text-sm font-semibold text-zinc-500">0{index + 1}</span>
                    </div>
                    <h3 className="mt-5 text-lg font-semibold">{step.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{step.detail}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="governance" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="overflow-hidden rounded-[34px] border border-emerald-100 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
            <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="bg-[#f0f8f1] p-6 sm:p-8 lg:p-10">
                <p className="text-sm font-semibold text-emerald-700">GOVERNANCE VALUE</p>
                <h2 className="mt-3 text-4xl font-semibold tracking-normal text-zinc-950">把用户推荐沉淀成治理侧可解释的分流建议</h2>
                <p className="mt-4 text-base leading-8 text-zinc-600">
                  当某个目的地高占用时，系统不把所有车辆继续导向最近点，而是展示可承接备选、候选资源和待补数据字段，支持校园停车治理试点分析。
                </p>
                <Link
                  to="/admin/governance"
                  className="mt-7 inline-flex h-12 items-center rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  查看治理分析
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
              <div className="p-6 sm:p-8 lg:p-10">
                <div className="space-y-3">
                  {[
                    ['高风险目的地', '占用率高、余位下降、数据过期时提示谨慎前往。'],
                    ['备选承接点', 'Plan B / Plan C 以可停概率和距离共同排序。'],
                    ['候选资源核验', 'OSM 与开放数据候选仅作为待调研资源，不宣称真实可用。']
                  ].map(([title, text]) => (
                    <div key={title} className="flex gap-3 rounded-3xl border border-zinc-100 bg-zinc-50 p-4">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-600" />
                      <div>
                        <p className="font-semibold text-zinc-950">{title}</p>
                        <p className="mt-1 text-sm leading-6 text-zinc-600">{text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

const AiParkingScene = () => (
  <div className="absolute inset-0 overflow-hidden bg-[#eef7ef]" aria-hidden="true">
    <div className="absolute inset-0 opacity-[0.46] [background-image:linear-gradient(#d8eadc_1px,transparent_1px),linear-gradient(90deg,#d8eadc_1px,transparent_1px)] [background-size:72px_72px]" />
    <div className="absolute inset-x-0 bottom-0 top-16">
      <div className="absolute left-[45%] top-[5%] h-[105%] w-16 -rotate-[24deg] rounded-full bg-white/75 shadow-[0_0_0_1px_rgba(16,185,129,0.10)]" />
      <div className="absolute left-[58%] top-[-12%] h-[125%] w-14 rotate-[18deg] rounded-full bg-white/68 shadow-[0_0_0_1px_rgba(16,185,129,0.10)]" />
      <div className="absolute left-[22%] top-[42%] h-12 w-[70%] -rotate-[6deg] rounded-full bg-white/74 shadow-[0_0_0_1px_rgba(16,185,129,0.10)]" />
      <div className="absolute left-[16%] top-[66%] h-10 w-[62%] rotate-[8deg] rounded-full bg-white/62 shadow-[0_0_0_1px_rgba(16,185,129,0.10)]" />
    </div>

    <div className="absolute right-[-6%] top-[18%] hidden h-[58vh] w-[58vw] max-w-[760px] rounded-[44px] border border-white/80 bg-white/44 shadow-[0_40px_100px_rgba(15,23,42,0.12)] backdrop-blur-sm md:block">
      <div className="absolute inset-6 rounded-[34px] border border-emerald-100 bg-[#f7fbf7]/78">
        <div className="grid h-full grid-cols-8 grid-rows-6 gap-2 p-5">
          {Array.from({ length: 48 }).map((_, index) => {
            const occupied = [3, 8, 11, 17, 26, 34, 41].includes(index);
            const recommended = [20, 29].includes(index);
            return (
              <div
                key={index}
                className={`rounded-xl border ${
                  recommended
                    ? 'border-emerald-400 bg-emerald-200 shadow-[0_10px_24px_rgba(16,185,129,0.22)]'
                    : occupied
                      ? 'border-amber-200 bg-amber-100'
                      : 'border-emerald-100 bg-white/88'
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>

    {heroLots.map((lot) => (
      <motion.div
        key={lot.name}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, delay: lot.tone === 'primary' ? 0.25 : 0.35 }}
        className={`absolute hidden min-w-[132px] rounded-2xl border px-3 py-2 text-xs font-semibold md:block ${toneClasses[lot.tone]}`}
        style={{ left: lot.x, top: lot.y }}
      >
        <div className="flex items-center justify-between gap-3">
          <span>{lot.name}</span>
          <span>{lot.probability}</span>
        </div>
      </motion.div>
    ))}

    <div className="pointer-events-none absolute bottom-8 left-4 right-4 hidden rounded-[28px] border border-emerald-100 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.10)] md:hidden">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
          <ParkingCircle className="mr-1 h-3.5 w-3.5" />
          AI 首选
        </span>
        <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          可停 92%
        </span>
      </div>
      <p className="mt-3 text-lg font-semibold text-zinc-950">北京高校校园东门试点停车场</p>
      <p className="mt-1 text-sm text-zinc-500">Plan B 已就绪 · 可生成到场码</p>
    </div>
  </div>
);

export default LandingPage;
