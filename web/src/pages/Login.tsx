import { useState } from "react";
import { setToken, hasToken, api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage() {
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!token.trim()) {
      setError("请输入令牌");
      return;
    }

    setLoading(true);
    setError("");

    try {
      setToken(token.trim());
      await api.ping();
      window.location.reload();
    } catch {
      setError("令牌无效，或守护进程未启动");
      setToken("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl">Hi-Boss</CardTitle>
          <p className="text-center text-muted-foreground text-sm">
            请输入 Boss 令牌继续使用
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <input
              type="password"
              placeholder="Boss 令牌"
              value={token}
              onChange={(e) => setTokenValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button
              onClick={handleLogin}
              disabled={loading}
              className="w-full"
            >
              {loading ? "连接中..." : "连接"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export { hasToken };
