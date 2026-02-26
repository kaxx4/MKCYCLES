import { useUIStore } from "../store/uiStore";

export function UnitToggle() {
  const unitMode = useUIStore((s) => s.unitMode);
  const toggleUnitMode = useUIStore((s) => s.toggleUnitMode);

  return (
    <button
      onClick={toggleUnitMode}
      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-amber-50 hover:border-amber-400 hover:text-amber-700 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
      aria-label={`Current mode: ${unitMode}. Click to toggle.`}
    >
      {unitMode === "BASE" ? "[PCS ⇄ PKG]" : "[PKG ⇄ PCS]"}
    </button>
  );
}
