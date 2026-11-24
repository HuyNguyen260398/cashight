import { VISUAL_SETTINGS_KEY } from './visual-settings';

/**
 * Runs in <head> before first paint so a saved dark/compact choice applies
 * without a light flash. Mirrors loadVisualSettings/resolveMode; the runtime
 * applyVisualSettings() takes over once React mounts.
 */
export const VISUAL_SETTINGS_SCRIPT = `(function(){try{var s={};try{s=JSON.parse(localStorage.getItem(${JSON.stringify(
  VISUAL_SETTINGS_KEY,
)})||'{}')||{}}catch(e){}var m=s.mode;var dark=m==='dark'||((m!=='light')&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;if(dark)c.add('awsui-dark-mode');if(s.density==='compact')c.add('awsui-compact-mode')}catch(e){}})();`;

export function VisualSettingsScript() {
  return <script dangerouslySetInnerHTML={{ __html: VISUAL_SETTINGS_SCRIPT }} />;
}
