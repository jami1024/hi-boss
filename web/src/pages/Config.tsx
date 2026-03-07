import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { api, type DaemonConfig } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ConfigPage() {
  const [config, setConfig] = useState<DaemonConfig | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Edit form
  const [bossName, setBossName] = useState("");
  const [bossTimezone, setBossTimezone] = useState("");

  const loadConfig = useCallback(async () => {
    try {
      const result = await api.getConfig();
      setConfig(result);
      setBossName(result.bossName);
      setBossTimezone(result.bossTimezone);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveError("");
    setSaveSuccess(false);

    try {
      const params: Record<string, string> = {};
      if (bossName !== config.bossName) params.bossName = bossName.trim();
      if (bossTimezone !== config.bossTimezone) params.bossTimezone = bossTimezone.trim();

      if (Object.keys(params).length === 0) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
        setSaving(false);
        return;
      }

      await api.updateConfig(params);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      await loadConfig();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">Error: {error}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Configuration</h1>

      {/* Overview */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Setup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={config.setupCompleted ? "default" : "destructive"}>
                {config.setupCompleted ? "Complete" : "Incomplete"}
              </Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Agents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{config.agentCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Bindings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{config.bindingCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Adapters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{config.adapters.length}</p>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Boss Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Boss Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bossName">Boss Name</Label>
              <Input
                id="bossName"
                value={bossName}
                onChange={(e) => setBossName(e.target.value)}
                placeholder="Your name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bossTimezone">Boss Timezone</Label>
              <Input
                id="bossTimezone"
                value={bossTimezone}
                onChange={(e) => setBossTimezone(e.target.value)}
                placeholder="e.g. Asia/Shanghai"
              />
              <p className="text-xs text-muted-foreground">
                IANA timezone (e.g. America/New_York, Asia/Shanghai)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
            {saveSuccess && (
              <span className="text-sm text-green-600">Saved successfully</span>
            )}
            {saveError && (
              <span className="text-sm text-destructive">{saveError}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* System Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">System Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Data Directory</span>
              <span className="font-mono text-xs">{config.dataDir}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Boss Timezone</span>
              <span>{config.bossTimezone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Daemon Timezone</span>
              <span>{config.daemonTimezone}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Adapters */}
      {config.adapters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Adapters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {config.adapters.map((adapter) => (
              <div key={adapter.type} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium capitalize">{adapter.type}</span>
                  {adapter.bossId && (
                    <Badge variant="outline" className="text-xs font-mono">
                      Boss: {adapter.bossId}
                    </Badge>
                  )}
                </div>
                {adapter.bindings.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {adapter.bindings.map((agent) => (
                      <Badge key={agent} variant="secondary" className="text-xs">
                        {agent}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Registered Agents */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Registered Agents</CardTitle>
            <Badge variant="outline">{config.agents.length} total</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {config.agents.map((agent) => (
              <div
                key={agent.name}
                className="flex items-center justify-between text-sm border rounded-lg p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  <Badge
                    variant={agent.role === "speaker" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {agent.role}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="text-xs">{agent.provider}</span>
                  {agent.workspace && (
                    <span
                      className="font-mono text-xs truncate max-w-[200px]"
                      title={agent.workspace}
                    >
                      {agent.workspace}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
