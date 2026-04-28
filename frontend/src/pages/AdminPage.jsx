import React, { useState, useEffect } from 'react';
import { Link, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import {
  BarChart3,
  Database,
  LayoutDashboard,
  LogOut,
  Map,
  ParkingCircle,
  Settings,
  Signal,
  Users,
  Video
} from 'lucide-react';
import AdminDashboard from '../components/AdminDashboard';
import AdminLots from '../components/AdminLots';
import AdminLotStatus from '../components/AdminLotStatus';
import AdminDataSources from '../components/AdminDataSources';
import AdminGovernanceOverview from '../components/AdminGovernanceOverview';
import AdminVideo from '../components/AdminVideo';
import AdminUsers from '../components/AdminUsers';
import AdminAnalytics from '../components/AdminAnalytics';
import AdminSettings from '../components/AdminSettings';
import { useAuth } from '../contexts/AuthContext';
import { parkingService } from '../services/api';
import BrandMark, { CapabilityStrip, PilotBoundaryNote } from '../components/BrandMark';

const AdminPage = () => {
  const { user, logout } = useAuth();
  const [lots, setLots] = useState([]);
  const [loadingLots, setLoadingLots] = useState(false);

  const navigation = [
    { name: '总览', href: '/admin', icon: LayoutDashboard, end: true },
    { name: '运维状态', href: '/admin/status', icon: Signal },
    { name: '数据源台账', href: '/admin/data-sources', icon: Database },
    { name: '治理分析', href: '/admin/governance', icon: Map },
    { name: '停车场管理', href: '/admin/lots', icon: ParkingCircle },
    { name: '视频识别', href: '/admin/video', icon: Video },
    { name: '统计报表', href: '/admin/analytics', icon: BarChart3 },
    { name: '用户权限', href: '/admin/users', icon: Users },
    { name: '系统设置', href: '/admin/settings', icon: Settings },
  ];

  useEffect(() => {
    const loadLots = async () => {
      try {
        setLoadingLots(true);
        const res = await parkingService.getAllParkingLots();
        if (res.data?.success) {
          setLots(res.data.data.parking_lots || res.data.data || []);
        }
      } catch (_) {
        setLots([]);
      } finally {
        setLoadingLots(false);
      }
    };
    loadLots();
  }, []);

  return (
    <div className="flex min-h-screen bg-[#f4f6f3] text-zinc-950">
      <aside className="hidden w-72 flex-col border-r border-zinc-200 bg-white md:flex">
        <div className="flex h-16 items-center border-b border-zinc-200 px-5">
          <BrandMark size="sm" subtitle="AI 车位感知与停车诱导治理平台" />
        </div>

        <div className="border-b border-zinc-100 px-4 py-4">
          <CapabilityStrip />
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5">
          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.name}
                to={item.href}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-zinc-950 text-white shadow-sm'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {item.name}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-zinc-200 p-4">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">当前账号</p>
            <p className="mt-1 text-sm font-medium text-zinc-950">{user?.username || 'admin'}</p>
            <button
              type="button"
              onClick={logout}
              className="mt-3 inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              退出登录
            </button>
            <Link
              to="/parking-lots"
              className="mt-2 inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              停车服务
            </Link>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-zinc-200/80 bg-white/90 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-950">ParkGov AI 运维与治理工作台</p>
              <p className="truncate text-xs text-zinc-500">
                当前纳管 {loadingLots ? '...' : lots.length} 个停车场，覆盖车位感知、分流推荐、治理研判三条演示链路。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/parking-lots"
                className="hidden rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:inline-flex"
              >
                停车服务
              </Link>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <LogOut className="mr-1.5 h-4 w-4" />
                退出
              </button>
            </div>
          </div>
        </header>

        <div className="border-b border-zinc-200 bg-white px-4 py-3 md:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {navigation.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.name}
                  to={item.href}
                  end={item.end}
                  className={({ isActive }) =>
                    `inline-flex flex-none items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium ${
                      isActive ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-700'
                    }`
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.name}
                </NavLink>
              );
            })}
          </div>
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="px-4 py-6 sm:px-6 lg:px-8">
            <PilotBoundaryNote className="mb-5 rounded-lg border border-zinc-200 bg-white px-4 py-3" />
            <Routes>
              <Route path="/" element={<AdminDashboard />} />
              <Route path="/status" element={<AdminLotStatus />} />
              <Route path="/data-sources" element={<AdminDataSources />} />
              <Route path="/governance" element={<AdminGovernanceOverview />} />
              <Route path="/lots" element={<AdminLots />} />
              <Route path="/video" element={<AdminVideo />} />
              <Route path="/analytics" element={<AdminAnalytics />} />
              <Route path="/users" element={<AdminUsers />} />
              <Route path="/settings" element={<AdminSettings />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminPage;
