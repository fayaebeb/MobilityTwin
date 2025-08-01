import { useState, useRef, useCallback } from 'react';
import type { LiveSimulationData, SimulationResponse } from '@shared/schema';

interface LiveSimulationState {
  isRunning: boolean;
  liveData: LiveSimulationData | null;
  finalResults: SimulationResponse | null;
  logs: string[];
  error: string | null;
}

export function useLiveSimulation() {
  const [state, setState] = useState<LiveSimulationState>({
    isRunning: false,
    liveData: null,
    finalResults: null,
    logs: [],
    error: null
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const startLiveSimulation = useCallback((duration: number = 60, radius: number = 3) => {
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Clear state completely before starting new simulation
    setState({
      isRunning: true,
      liveData: null,
      finalResults: null,
      logs: [],
      error: null
    });

    // Add a small delay to ensure cleanup is complete
    setTimeout(() => {
      const eventSource = new EventSource(
        `/api/simulate/live?duration=${duration}&radius=${radius}`
      );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'status':
            setState(prev => ({
              ...prev,
              logs: [...prev.logs, data.message]
            }));
            break;

          case 'live_data':
            console.log('Received live data:', data.data);
            setState(prev => ({
              ...prev,
              liveData: data.data,
              logs: [...prev.logs, data.message]
            }));
            break;

          case 'complete':
            setState(prev => ({
              ...prev,
              finalResults: data.data,
              isRunning: false,
              logs: [...prev.logs, '✅ Simulation completed successfully!']
            }));
            eventSource.close();
            break;

          case 'error':
            setState(prev => ({
              ...prev,
              error: data.message,
              isRunning: false,
              logs: [...prev.logs, data.message]
            }));
            eventSource.close();
            break;

          default:
            // Handle legacy string messages
            if (typeof data === 'string') {
              setState(prev => ({
                ...prev,
                logs: [...prev.logs, data]
              }));
            }
        }
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    };

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        setState(prev => ({
          ...prev,
          error: 'Connection error occurred',
          isRunning: false,
          logs: [...prev.logs, '❌ Connection error occurred']
        }));
        eventSource.close();
      };

      eventSourceRef.current = eventSource;
    }, 100); // 100ms delay
  }, []);

  const stopLiveSimulation = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState(prev => ({
      ...prev,
      isRunning: false,
      logs: [...prev.logs, '⏹️ Simulation stopped by user']
    }));
  }, []);

  const clearResults = useCallback(() => {
    setState({
      isRunning: false,
      liveData: null,
      finalResults: null,
      logs: [],
      error: null
    });
  }, []);

  return {
    ...state,
    startLiveSimulation,
    stopLiveSimulation,
    clearResults
  };
}