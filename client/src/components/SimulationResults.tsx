import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Route, AlertTriangle, Leaf, Bot, Lightbulb, FileText, FileSpreadsheet } from 'lucide-react';
import type { SimulationResponse, RiskItem, Recommendation } from '@shared/schema';
import { Button } from '@/components/ui/button';

interface SimulationResultsProps {
  isLoading: boolean;
  simulationResults: SimulationResponse | null;
  onClear: () => void;
}

const getRiskColor = (level: string) => {
  switch (level) {
    case 'high': return 'bg-red-50 text-red-700 border-red-200';
    case 'medium': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'low': return 'bg-green-50 text-green-700 border-green-200';
    default: return 'bg-gray-50 text-gray-700 border-gray-200';
  }
};

const getRiskDot = (level: string) => {
  switch (level) {
    case 'high': return 'bg-red-500';
    case 'medium': return 'bg-yellow-500';
    case 'low': return 'bg-green-500';
    default: return 'bg-gray-500';
  }
};

export default function SimulationResults({ isLoading, simulationResults, onClear }: SimulationResultsProps) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-6 pt-6 pb-12 will-change-transform">
      <div className="space-y-6">
        {isLoading && (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-center space-x-3">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <div>
                  <div className="text-sm font-medium text-gray-900">Running Simulation...</div>
                  <div className="text-xs text-gray-500">Processing traffic data with SUMO</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {simulationResults && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="space-y-2">
              <h3 className="text-base font-medium text-gray-900">Key Metrics</h3>

              {/* === CO₂ Dynamic Formatting === */}
              {(() => {
                const emissionsRaw = simulationResults.metrics.co2_emissions; // e.g., "185" or "1540"
                const emissionsValue = parseFloat(emissionsRaw);
                const emissionsDisplay = emissionsValue >= 1000
                  ? `${(emissionsValue / 1000).toFixed(2)} kg`
                  : `${emissionsValue} g`;

                const metrics = [
                  {
                    icon: <Route className="h-4 w-4 text-gray-600" />,
                    label: 'Total Distance',
                    value: simulationResults.metrics.driving_distance,
                  },
                  {
                    icon: <AlertTriangle className="h-4 w-4 text-accent" />,
                    label: 'Congestion',
                    value: simulationResults.metrics.congestion_length,
                  },
                  {
                    icon: <Leaf className="h-4 w-4 text-secondary" />,
                    label: 'CO₂ Emissions',
                    value: emissionsDisplay,
                  },
                ];

                return (
                  <div className="space-y-3">
                    {metrics.map((metric, i) => (
                      <Card key={i} className="bg-gray-50">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              {metric.icon}
                              <span className="text-sm text-gray-600">{metric.label}</span>
                            </div>
                            <span className="text-lg font-semibold text-gray-900">
                              {metric.value}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                );
              })()}
            </div>

            {(simulationResults.metrics.roads_count || simulationResults.metrics.vehicle_sample) && (
              <div className="space-y-4">
                <h3 className="text-base font-medium text-gray-900">Advanced Simulation Details</h3>

                <Card className="bg-gray-50 border border-gray-200">
                  <CardContent className="p-4 space-y-2 text-sm text-gray-700">
                    {simulationResults.metrics.roads_count && (
                      <div>🛣️ <strong>Roads:</strong> {simulationResults.metrics.roads_count}</div>
                    )}
                    {simulationResults.metrics.nodes_count && (
                      <div>🧭 <strong>Nodes:</strong> {simulationResults.metrics.nodes_count}</div>
                    )}
                    {simulationResults.metrics.incidents_count !== undefined && (
                      <div>🚧 <strong>Incidents:</strong> {simulationResults.metrics.incidents_count}</div>
                    )}
                    {simulationResults.metrics.affected_edges !== undefined && (
                      <div>🔀 <strong>Affected Edges:</strong> {simulationResults.metrics.affected_edges}</div>
                    )}
                    {simulationResults.metrics.vehicle_sample?.length > 0 && (
                      <div>
                        🚗 <strong>Sample Vehicles:</strong>
                        <ul className="mt-1 list-disc list-inside text-xs text-gray-600 space-y-1">
                          {simulationResults.metrics.vehicle_sample.map((v, i) => (
                            <li key={i}>
                              {v.id}: speed = {v.speed.toFixed(1)} km/h, route length = {v.routeLength}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {simulationResults.metrics.construction_impacts?.length > 0 && (
                      <div>
                        🚧 <strong>Construction Impacts:</strong>
                        <div className="mt-1 max-h-48 overflow-y-auto text-xs font-mono bg-orange-50 p-2 rounded border border-orange-200 space-y-1">
                          {simulationResults.metrics.construction_impacts.map((impact, i) => (
                            <div key={i}>
                              Edge <code>{impact.edgeId}</code>: {impact.originalSpeed} → {impact.reducedSpeed} km/h
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* AI Summary */}
            <div className="space-y-4">
              <h3 className="text-base font-medium text-gray-900">AI Impact Analysis</h3>
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="p-4">
                  <div className="flex items-start space-x-2">
                    <Bot className="h-5 w-5 text-primary mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900 mb-2">Traffic Impact Summary</div>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {simulationResults.ai_summary}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Risk Assessment */}
            {simulationResults.risk_assessment?.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-base font-medium text-gray-900">Risk Assessment</h3>
                <div className="space-y-3">
                  {simulationResults.risk_assessment.map((risk: RiskItem, index: number) => (
                    <div
                      key={index}
                      className={`flex items-center space-x-3 p-3 rounded-lg border ${getRiskColor(risk.level)}`}
                    >
                      <div className={`w-2 h-2 rounded-full ${getRiskDot(risk.level)}`} />
                      <span className="text-sm">{risk.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {simulationResults.recommendations?.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-base font-medium text-gray-900">Recommendations</h3>
                <div className="space-y-3">
                  {simulationResults.recommendations.map((rec: Recommendation, index: number) => (
                    <Card key={index} className="bg-green-50 border-green-200">
                      <CardContent className="p-3">
                        <div className="flex items-start space-x-3">
                          <Lightbulb className="h-4 w-4 text-secondary mt-1 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{rec.title}</div>
                            <p className="text-xs text-gray-600 mt-1">{rec.description}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Export */}
            <div className="space-y-4 pt-4 border-t border-gray-200">
              <h3 className="text-base font-medium text-gray-900">Export Results</h3>
              <div className="flex space-x-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <FileText className="mr-2 h-4 w-4" />
                  PDF Report
                </Button>
                <Button variant="outline" size="sm" className="flex-1">
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  CSV Data
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700" onClick={onClear}>
                Clear Results
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}