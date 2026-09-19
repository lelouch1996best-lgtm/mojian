import { notFound } from "next/navigation";
import { TOOL_REGISTRY, getToolById } from "@/lib/tools/registry";
import ToolPageShell from "@/components/tools/ToolPageShell";

// 预生成所有已启用工具的静态参数
export function generateStaticParams() {
  return TOOL_REGISTRY.filter((t) => t.enabled).map((t) => ({ id: t.id }));
}

export default function ToolPage({ params }: { params: { id: string } }) {
  const tool = getToolById(params.id);
  if (!tool) notFound();
  return <ToolPageShell tool={tool} />;
}
