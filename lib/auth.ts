/** Bearer Token 鉴权。开发模式跳过。 */
export function validateAuth(request: Request): boolean {
  if (process.env.NODE_ENV === "development" && !process.env.STORAGE_TOKEN) {
    return true;
  }
  const token = process.env.STORAGE_TOKEN;
  if (!token) return false;
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${token}`;
}

export function authError(): Response {
  return Response.json({ error: "未授权访问" }, { status: 401 });
}
