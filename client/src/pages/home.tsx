import { useState } from 'react';
import MapPanel from '@/components/map-panel';
import ControlPanel from '@/components/control-panel';
import { Route, HelpCircle, Settings } from 'lucide-react';
import type { LiveSimulationData } from '@shared/schema';

export default function Home() {
  const [markerCount, setMarkerCount] = useState(0);
  const [liveData, setLiveData] = useState<LiveSimulationData | null>(null);
  const [showVehicles, setShowVehicles] = useState(false);

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 z-50 relative">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Route className="text-white h-4 w-4" />
              </div>
              <div>
                <h1 className="text-xl font-medium text-gray-900">Mobility-Twin</h1>
                <p className="text-sm text-gray-500">Traffic Impact Simulation Platform</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-2">
                <HelpCircle className="h-4 w-4" />
                Help
              </button>
              <button className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        <MapPanel 
          onMarkersChange={setMarkerCount}
          liveData={liveData}
          showVehicles={showVehicles}
        />
        <ControlPanel 
          markerCount={markerCount}
          onLiveDataUpdate={setLiveData}
          onVehicleVisibilityChange={setShowVehicles}
        />
      </div>
    </div>
  );
}
