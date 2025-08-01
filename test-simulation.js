#!/usr/bin/env node

/**
 * Comprehensive Test Script for Traffic Simulation Accuracy
 * This script tests the accuracy of vehicle movement and simulation logic
 */

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:5173';

async function testSimulationAccuracy() {
  console.log('🔍 Testing Traffic Simulation Accuracy\n');

  try {
    // Test 1: Basic API connectivity
    console.log('1. Testing API connectivity...');
    const response = await fetch(`${BASE_URL}/api/markers`);
    if (response.ok) {
      console.log('✅ API is accessible');
    } else {
      console.log('❌ API connectivity issue');
      return;
    }

    // Test 2: Add test markers
    console.log('\n2. Adding test markers...');
    const testMarkers = [
      {
        type: 'construction',
        coordinates: { lng: -122.4194, lat: 37.7749 } // San Francisco
      },
      {
        type: 'facility', 
        coordinates: { lng: -122.4094, lat: 37.7849 }
      }
    ];

    for (const marker of testMarkers) {
      const markerResponse = await fetch(`${BASE_URL}/api/markers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(marker)
      });
      
      if (markerResponse.ok) {
        console.log(`✅ Added ${marker.type} marker`);
      } else {
        console.log(`❌ Failed to add ${marker.type} marker`);
      }
    }

    // Test 3: Live simulation test
    console.log('\n3. Testing live simulation with vehicle tracking...');
    
    let vehicleCount = 0;
    let positionUpdates = 0;
    let speedVariations = [];
    let headingChanges = [];
    let vehiclePositions = new Map();
    
    const eventSource = new EventSource(`${BASE_URL}/api/simulate/live?duration=10&radius=3`);
    
    let testTimer = setTimeout(() => {
      eventSource.close();
      console.log('\n❌ Test timeout - simulation may be stuck');
      process.exit(1);
    }, 60000); // 60 second timeout

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'live_data') {
          const liveData = data.data;
          vehicleCount = Math.max(vehicleCount, liveData.totalVehicles);
          
          // Track vehicle position accuracy
          liveData.vehicles.forEach(vehicle => {
            const prevPosition = vehiclePositions.get(vehicle.id);
            
            if (prevPosition) {
              // Calculate distance moved
              const distance = calculateDistance(
                prevPosition.coordinates, 
                vehicle.coordinates
              );
              
              // Check if movement is realistic (not teleporting)
              if (distance > 1000) { // More than 1km in a timestep
                console.log(`⚠️  Vehicle ${vehicle.id} teleported ${distance.toFixed(0)}m`);
              }
              
              // Track speed consistency
              speedVariations.push(Math.abs(vehicle.speed - prevPosition.speed));
              
              // Track heading changes
              const headingDiff = Math.abs(vehicle.heading - prevPosition.heading);
              headingChanges.push(headingDiff > 180 ? 360 - headingDiff : headingDiff);
              
              positionUpdates++;
            }
            
            vehiclePositions.set(vehicle.id, {
              coordinates: vehicle.coordinates,
              speed: vehicle.speed,
              heading: vehicle.heading,
              routeProgress: vehicle.routeProgress
            });
          });
          
          // Log progress every few updates
          if (positionUpdates % 50 === 0) {
            console.log(`📊 Tracking ${liveData.vehicles.length} vehicles, avg speed: ${liveData.averageSpeed.toFixed(1)} km/h`);
          }
        }
        
        if (data.type === 'status' && data.message.includes('complete')) {
          clearTimeout(testTimer);
          eventSource.close();
          
          // Analyze results
          console.log('\n📈 Simulation Analysis Results:');
          console.log(`- Total vehicles observed: ${vehicleCount}`);
          console.log(`- Position updates tracked: ${positionUpdates}`);
          
          if (speedVariations.length > 0) {
            const avgSpeedChange = speedVariations.reduce((a, b) => a + b, 0) / speedVariations.length;
            console.log(`- Average speed variation: ${avgSpeedChange.toFixed(2)} km/h`);
            
            if (avgSpeedChange > 50) {
              console.log('⚠️  High speed variations detected - may indicate unrealistic behavior');
            } else {
              console.log('✅ Speed variations within realistic range');
            }
          }
          
          if (headingChanges.length > 0) {
            const avgHeadingChange = headingChanges.reduce((a, b) => a + b, 0) / headingChanges.length;
            console.log(`- Average heading change: ${avgHeadingChange.toFixed(2)}°`);
            
            if (avgHeadingChange > 90) {
              console.log('⚠️  Sharp heading changes detected - vehicles may be jumping between roads');
            } else {
              console.log('✅ Heading changes appear realistic');
            }
          }
          
          // Test accuracy conclusions
          console.log('\n🎯 Accuracy Assessment:');
          
          if (vehicleCount === 0) {
            console.log('❌ No vehicles generated - simulation failed');
          } else if (vehicleCount < 50) {
            console.log('⚠️  Low vehicle count - may not be realistic for urban simulation');
          } else {
            console.log('✅ Vehicle generation appears adequate');
          }
          
          if (positionUpdates === 0) {
            console.log('❌ No position updates received - vehicle animation not working');
          } else {
            console.log('✅ Vehicle position updates are working');
          }
          
          console.log('\n✅ Simulation test completed');
          process.exit(0);
        }
        
      } catch (error) {
        console.error('Error parsing simulation data:', error.message);
      }
    };

    eventSource.onerror = (error) => {
      console.error('❌ EventSource error:', error);
      clearTimeout(testTimer);
      eventSource.close();
      process.exit(1);
    };

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

function calculateDistance(coord1, coord2) {
  const R = 6371000; // Earth's radius in meters
  const lat1Rad = coord1[1] * Math.PI / 180;
  const lat2Rad = coord2[1] * Math.PI / 180;
  const deltaLat = (coord2[1] - coord1[1]) * Math.PI / 180;
  const deltaLng = (coord2[0] - coord1[0]) * Math.PI / 180;

  const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLng/2) * Math.sin(deltaLng/2);
  
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// EventSource polyfill for Node.js
if (typeof EventSource === 'undefined') {
  const EventSource = require('eventsource');
  global.EventSource = EventSource;
}

testSimulationAccuracy();