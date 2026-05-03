import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  BarChart3,
  GitBranch,
  Eye,
  EyeOff,
  Lock,
  User,
  Video
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { toast } from 'react-hot-toast';
import BrandMark, { CapabilityStrip, PilotBoundaryNote } from '../components/BrandMark';

const LoginPage = () => {
  const { login, loading, error, clearError } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Clear errors when component mounts
  useEffect(() => {
    clearError();
    setFormErrors({});
  }, [clearError]);

  // Handle input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear field-specific error
    if (formErrors[name]) {
      setFormErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  // Validate form
  const validateForm = () => {
    const errors = {};

    if (!formData.username.trim()) {
      errors.username = '请输入用户名';
    }

    if (!formData.password) {
      errors.password = '请输入密码';
    } else if (formData.password.length < 6) {
      errors.password = '密码至少需要 6 位';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await login(formData);
      
      if (result.success) {
        toast.success('登录成功');
      } else {
        toast.error(result.error || '登录失败');
      }
    } catch (err) {
      console.error('Login error:', err);
      toast.error('登录时发生异常');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle demo login
  const handleDemoLogin = async (role) => {
    if (role === 'user') {
      toast.success('已进入用户端停车服务演示');
      navigate('/parking-lots');
      return;
    }

    const demoCredentials = {
      admin: { username: 'admin', password: 'admin123' },
    };

    setFormData(demoCredentials[role]);
    setIsSubmitting(true);

    try {
      const result = await login(demoCredentials[role]);
      
      if (result.success) {
        toast.success(role === 'admin' ? '已进入管理端演示账号' : '已进入用户端演示账号');
      } else {
        toast.error(result.error || '演示账号登录失败');
      }
    } catch (err) {
      console.error('Demo login error:', err);
      toast.error('演示账号登录失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f6f3] text-zinc-950 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(440px,520px)]">
      <section className="relative hidden overflow-hidden bg-zinc-950 px-10 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-55">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
              backgroundSize: '38px 38px'
            }}
          />
          <div className="absolute -right-20 top-24 h-72 w-72 rounded-full border border-emerald-300/20" />
          <div className="absolute bottom-24 left-12 grid grid-cols-6 gap-2">
            {Array.from({ length: 36 }).map((_, index) => (
              <span
                key={index}
                className={`h-10 w-5 rounded-[3px] border ${
                  index % 7 === 0 ? 'border-amber-300/45 bg-amber-300/15' : 'border-emerald-300/35 bg-emerald-300/10'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="relative">
          <BrandMark inverted showBadge subtitle="北京高校停车治理试点平台" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65 }}
          className="relative max-w-xl"
        >
          <CapabilityStrip inverted />
          <h1 className="mt-6 text-4xl font-semibold leading-tight">
            把车位识别结果，变成可解释的停车诱导与治理研判。
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-7 text-zinc-300">
            面向北京高校试点场景，串联 AI 车位感知、分流推荐、管理端运维与治理侧分析，让小组演示时能讲清楚为什么推荐、数据从哪里来、边界在哪里。
          </p>
        </motion.div>

        <div className="relative grid grid-cols-3 gap-3 text-sm">
          {[
            { label: 'AI 识别', icon: Video, detail: '图片/视频样例' },
            { label: '分流推荐', icon: GitBranch, detail: '不只按最近排序' },
            { label: '治理分析', icon: BarChart3, detail: '区域与来源核验' }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                <Icon className="h-5 w-5 text-emerald-300" />
                <p className="mt-3 font-semibold text-white">{item.label}</p>
                <p className="mt-1 text-xs text-zinc-400">{item.detail}</p>
              </div>
            );
          })}
        </div>
      </section>

      <main className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-between gap-4">
            <BrandMark size="sm" subtitle="AI 车位感知与停车诱导治理平台" showBadge />
            <Link
              to="/parking-lots"
              className="inline-flex flex-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              停车服务
            </Link>
          </div>

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            className="space-y-3"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Operations Login</p>
            <h2 className="text-3xl font-semibold leading-tight text-zinc-950">
              进入 ParkGov AI 管理工作台
            </h2>
            <p className="text-sm leading-6 text-zinc-600">
              登录后可查看停车场运维、数据源台账、AI 识别事件和治理分析；用户端停车诱导服务无需登录即可展示。
            </p>
            <PilotBoundaryNote />
          </motion.div>

          {/* Login Form */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12 }}
            className="rounded-xl border border-zinc-200 bg-white p-7 shadow-sm"
          >
          {/* Global Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 flex items-center rounded-lg border border-red-200 bg-red-50 p-4"
            >
              <AlertCircle className="mr-3 h-5 w-5 text-red-500" />
              <span className="text-red-700 text-sm">{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username Field */}
            <div>
              <label htmlFor="username" className="form-label">
                用户名
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  className={`form-input pl-10 ${formErrors.username ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                  placeholder="请输入用户名"
                  value={formData.username}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                />
              </div>
              {formErrors.username && (
                <p className="form-error">{formErrors.username}</p>
              )}
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="form-label">
                密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className={`form-input pl-10 pr-10 ${formErrors.password ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`}
                  placeholder="请输入密码"
                  value={formData.password}
                  onChange={handleInputChange}
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isSubmitting}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  )}
                </button>
              </div>
              {formErrors.password && (
                <p className="form-error">{formErrors.password}</p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || loading}
              className="relative inline-flex w-full items-center justify-center rounded-md bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting || loading ? (
                <>
                  <LoadingSpinner size="small" color="white" className="mr-2" />
                  正在登录...
                </>
              ) : (
                '登录管理端'
              )}
            </button>
          </form>

          {/* Demo Accounts */}
          <div className="mt-7 border-t border-zinc-200 pt-6">
            <p className="mb-4 text-center text-sm font-medium text-zinc-700">
              本地演示账号
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleDemoLogin('admin')}
                disabled={isSubmitting || loading}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                管理员演示
              </button>
              <button
                onClick={() => handleDemoLogin('user')}
                disabled={isSubmitting || loading}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                用户端演示
              </button>
            </div>
            <PilotBoundaryNote className="mt-3 text-center" />
          </div>
        </motion.div>

        {/* Features */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-center"
        >
          <div className="grid grid-cols-3 gap-3 text-sm text-zinc-600">
            <div className="flex flex-col items-center">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                <Video className="h-4 w-4 text-emerald-700" />
              </div>
              <span>AI 识别</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
                <GitBranch className="h-4 w-4 text-emerald-700" />
              </div>
              <span>分流推荐</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
                <BarChart3 className="h-4 w-4 text-amber-700" />
              </div>
              <span>治理分析</span>
            </div>
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="text-center text-sm text-zinc-500"
        >
          <p>Challenge Cup MVP · ParkGov AI 试点原型</p>
        </motion.div>
      </div>
    </main>
    </div>
  );
};

export default LoginPage;
