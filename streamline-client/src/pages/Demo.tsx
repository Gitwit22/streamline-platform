import { Button } from "@/components/ui/button";
import { ArrowRight, GraduationCap, Building2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function Demo() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background blobs */}
      <div className="absolute top-[-120px] left-[-80px] w-[400px] h-[400px] rounded-full bg-indigo-600/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-100px] right-[-60px] w-[350px] h-[350px] rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="text-center mb-14 relative z-10">
        <h1 className="text-6xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent mb-3">
          StreamLine
        </h1>
        <p className="text-xl text-slate-300 font-medium">
          Choose your experience
        </p>
        <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
          Built for schools and enterprises — powered by the same core engine.
        </p>
      </div>

      {/* Lane cards */}
      <div className="grid md:grid-cols-2 gap-8 max-w-4xl w-full relative z-10">

        {/* EDU Card */}
        <Link to="/streamline/edu" className="group block">
          <div className="relative rounded-2xl border border-indigo-500/20 bg-slate-900/70 backdrop-blur-sm p-8 transition-all duration-300 hover:border-indigo-400/50 hover:shadow-[0_0_40px_-8px_rgba(99,102,241,0.3)] hover:-translate-y-1">
            {/* Accent bar */}
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-indigo-500 to-violet-500" />

            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/15 text-indigo-400">
                <GraduationCap className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">StreamLine EDU</h2>
                <p className="text-sm text-slate-400">For schools &amp; universities</p>
              </div>
            </div>

            <ul className="space-y-2 text-slate-300 text-sm mb-8">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                School broadcasts &amp; live events
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                Replays &amp; recording management
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                Role-based access &amp; permissions
              </li>
            </ul>

            <Button className="w-full bg-indigo-600 hover:bg-indigo-500 text-white border-0 transition-colors group-hover:shadow-lg">
              Enter EDU <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </Link>

        {/* Corporate Card */}
        <Link to="/streamline/corporate/landing" className="group block">
          <div className="relative rounded-2xl border border-cyan-500/20 bg-slate-900/70 backdrop-blur-sm p-8 transition-all duration-300 hover:border-cyan-400/50 hover:shadow-[0_0_40px_-8px_rgba(6,182,212,0.3)] hover:-translate-y-1">
            {/* Accent bar */}
            <div className="absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-cyan-500 to-teal-500" />

            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-cyan-500/15 text-cyan-400">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">StreamLine Corporate</h2>
                <p className="text-sm text-slate-400">For teams &amp; enterprises</p>
              </div>
            </div>

            <ul className="space-y-2 text-slate-300 text-sm mb-8">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                Internal comms &amp; company broadcasts
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                Video calls, chat &amp; training
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                Compliance tracking &amp; audit logs
              </li>
            </ul>

            <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white border-0 transition-colors group-hover:shadow-lg">
              Enter Corporate <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </Link>
      </div>

      {/* Footer */}
      <p className="text-xs text-slate-600 mt-12 relative z-10">
        © {new Date().getFullYear()} Nxt Lvl Technology Solutions
      </p>
    </div>
  );
}
