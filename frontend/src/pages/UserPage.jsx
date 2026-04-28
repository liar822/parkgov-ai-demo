import React, { useState, useEffect } from 'react';
import { Link, Routes, Route, Navigate } from 'react-router-dom';
import UserDashboard from '../components/UserDashboard';
import { useAuth } from '../contexts/AuthContext';
import { useParking } from '../contexts/ParkingContext';
import LoadingSpinner from '../components/LoadingSpinner';
import BrandMark from '../components/BrandMark';

const UserPage = () => {
  const { user, logout } = useAuth();
  const { parkingLots, loading, loadParkingLots } = useParking();
  const [selectedLotId, setSelectedLotId] = useState(null);

  useEffect(() => {
    loadParkingLots();
  }, [loadParkingLots]);

  useEffect(() => {
    // Auto-select first parking lot if none selected
    if (parkingLots.length > 0 && !selectedLotId) {
      setSelectedLotId(parkingLots[0].id);
    }
  }, [parkingLots, selectedLotId]);

  if (loading && parkingLots.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f3]">
        <LoadingSpinner size="large" text="正在加载 ParkGov AI 停车服务..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f6f3]">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/90 shadow-sm backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <BrandMark size="sm" subtitle={`用户端演示 · ${user?.username || 'demo'}`} showBadge />

            <div className="flex items-center space-x-4">
              <Link
                to="/parking-lots"
                className="hidden rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:inline-flex"
              >
                停车服务首页
              </Link>

              {/* Parking Lot Selector */}
              {parkingLots.length > 1 && (
                <select
                  value={selectedLotId || ''}
                  onChange={(e) => setSelectedLotId(parseInt(e.target.value))}
                  className="form-input text-sm"
                >
                  <option value="">选择停车场</option>
                  {parkingLots.map(lot => (
                    <option key={lot.id} value={lot.id}>
                      {lot.name}
                    </option>
                  ))}
                </select>
              )}

              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={logout}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  退出
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route 
            path="/" 
            element={
              <UserDashboard 
                selectedLotId={selectedLotId}
                parkingLots={parkingLots}
                onLotChange={setSelectedLotId}
              />
            } 
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default UserPage;
