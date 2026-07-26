export function AccessRequiredPage({
  loading = false,
  error = "",
}: {
  loading?: boolean;
  error?: string;
}) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-avatar">亲</span>
        </div>
        <h1 className="login-title">亲宝贝</h1>
        <p className="login-subtitle">家庭云相册</p>
        <div className="login-form">
          <p className="login-guide">
            {loading ? "正在验证微信访问权限…" : "请返回微信小程序，从“亲宝贝”卡片进入客服会话并打开收到的链接。"}
          </p>
          {error && <p className="login-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
