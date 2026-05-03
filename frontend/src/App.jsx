import React, { useState, useEffect } from 'react';
import { Link, Routes, Route, Navigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { AlertTriangle, ArrowRight, LogIn, ParkingCircle } from 'lucide-react';

// Import pages and components
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';
import UserPage from './pages/UserPage';
import ParkingLotsPage from './pages/ParkingLotsPage';
import LandingPage from './pages/LandingPage';
import LoadingSpinner from './components/LoadingSpinner';
import BrandMark, { PilotBoundaryNote } from './components/BrandMark';

// Import services
import { authService } from './services/api';
import { websocketService } from './services/websocket';

// Import context providers
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ParkingProvider } from './contexts/ParkingContext';

function App() {
  return (
    <AuthProvider>
      <ParkingProvider>
        <AppContent />
      </ParkingProvider>
    </AuthProvider>
  );
}

function AppContent() {
  const { user, loading, login } = useAuth();
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // Initialize the application
    const initializeApp = async () => {
      try {
        // Check if user is already logged in
        const token = localStorage.getItem('parking_token');
        if (token) {
          // Validate token and get user info
          try {
            const response = await authService.validateToken();
            if (response.data.valid) {
              // Token is valid, user is already logged in
              console.log('User already authenticated');
            } else {
              // Token is invalid, remove it
              localStorage.removeItem('parking_token');
            }
          } catch (error) {
            console.error('Token validation failed:', error);
            localStorage.removeItem('parking_token');
          }
        }

        // Initialize WebSocket connection if user is authenticated
        if (user) {
          websocketService.connect();
          
          // Set up global WebSocket event handlers
          websocketService.on('connect', () => {
            console.log('Connected to parking system');
            toast.success('Connected to parking system');
          });

          websocketService.on('disconnect', () => {
            console.log('Disconnected from parking system');
            toast.error('Disconnected from parking system');
          });

          websocketService.on('error', (error) => {
            console.error('WebSocket error:', error);
            toast.error('Connection error occurred');
          });
        }

      } catch (error) {
        console.error('App initialization error:', error);
        toast.error('Failed to initialize application');
      } finally {
        setIsInitializing(false);
      }
    };

    initializeApp();

    // Cleanup on unmount
    return () => {
      websocketService.disconnect();
    };
  }, [user]);

  // Show loading screen during initialization
  if (loading || isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f3]">
        <div className="text-center">
          <LoadingSpinner size="large" />
          <p className="mt-4 text-lg text-zinc-600">
            正在加载 ParkGov AI 停车服务...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        {/* Public routes */}
        <Route
          path="/"
          element={<LandingPage />}
        />

        <Route 
          path="/parking-lots"
          element={<ParkingLotsPage />}
        />

        <Route
          path="/login" 
          element={
            user ? (
              <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />
            ) : (
              <LoginPage />
            )
          } 
        />

        {/* Protected routes */}
        <Route 
          path="/admin/*" 
          element={
            user && user.role === 'admin' ? (
              <AdminPage />
            ) : user ? (
              <AdminAccessDenied user={user} login={login} />
            ) : (
              <Navigate to="/login" replace />
            )
          } 
        />

        <Route 
          path="/dashboard/*" 
          element={
            user ? (
              <UserPage />
            ) : (
              <Navigate to="/login" replace />
            )
          } 
        />

        {/* 404 page */}
        <Route 
          path="*" 
          element={
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <div className="w-24 h-24 mx-auto mb-6 text-gray-400">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} 
                          d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.29-1.009-5.824-2.562M15 6.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h1 className="text-4xl font-bold text-gray-900 mb-4">页面不存在</h1>
                <p className="text-xl text-gray-600 mb-8">可以返回停车服务首页继续查看余位。</p>
                <Link
                  to="/parking-lots"
                  className="inline-flex items-center rounded-lg bg-zinc-950 px-6 py-3 text-white transition-colors hover:bg-zinc-800"
                >
                  停车服务
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
            </div>
          } 
        />
      </Routes>
    </div>
  );
}

function AdminAccessDenied({ user, login }) {
  const [switching, setSwitching] = useState(false);

  const handleSwitchToAdminDemo = async () => {
    setSwitching(true);

    try {
      const result = await login({ username: 'admin', password: 'admin123' });

      if (!result.success) {
        toast.error(result.error || '管理员演示账号登录失败');
      }
    } catch (error) {
      toast.error(error.message || '管理员演示账号登录失败');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/parking-lots" className="flex items-center gap-3">
            <BrandMark size="sm" subtitle="北京高校停车治理试点平台" showBadge />
          </Link>
          <Link
            to="/parking-lots"
            className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            停车服务
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <section className="grid w-full gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.58fr)] lg:items-center">
          <div>
            <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
              管理端权限受限
            </div>
            <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-normal text-zinc-950 sm:text-4xl">
              当前账号不能进入 AI 管理工作台
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-600">
              你当前使用的是 {user?.username || '普通用户'} 账号。管理端只面向管理员演示账号开放；用户端仍可查看停车场余位、收费和推荐信息。
            </p>
            <PilotBoundaryNote className="mt-3 max-w-2xl" />

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleSwitchToAdminDemo}
                disabled={switching}
                className="inline-flex items-center justify-center rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogIn className="mr-2 h-4 w-4" />
                {switching ? '正在切换...' : '切换管理员演示账号'}
              </button>
              <Link
                to="/dashboard"
                className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                返回用户端
              </Link>
              <Link
                to="/parking-lots"
                className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                查看停车服务
              </Link>
            </div>
          </div>

          <aside className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3 border-b border-zinc-200 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
                <ParkingCircle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-950">演示边界</p>
                <p className="text-xs text-zinc-500">权限和数据来源说明</p>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-600">
              <p>管理端用于展示停车场运维、AI 任务队列和治理数据分析。</p>
              <p>当前数据来自校园 demo、公开数据样例和 AI 数据集验证，不代表真实城市级部署。</p>
              <p>切换管理员演示账号只会登录本地 demo 系统，不会接入真实摄像头或外部账号。</p>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

export default App;
