"use client";

import { useState, useMemo } from "react";
import { Search, ExternalLink, Link2 } from "lucide-react";
import { useNav } from "@/store/nav";
import { toast } from "sonner";

interface LinkEntry {
  name: string;
  url: string;
  category: string;
}

// All opium / bull / fern / yuki mirror links from the user.
// These are stealth proxy mirrors — each one loads the TongSherbet
// loader disguised as a study/tutoring site.
const LINKS: LinkEntry[] = [
  // === Opium main mirrors ===
  { name: "opium.best", url: "https://opium.best/", category: "Opium" },
  { name: "opiumbest.github.io", url: "https://opiumbest.github.io/", category: "Opium" },
  { name: "cleverlearning S3", url: "https://s3.amazonaws.com/cleverlearning/index.html", category: "Opium" },
  { name: "cleverlearning S3 us-east-1", url: "https://s3.us-east-1.amazonaws.com/cleverlearning/index.html", category: "Opium" },
  { name: "opiumbest S3", url: "https://s3.amazonaws.com/opiumbest/index.html", category: "Opium" },
  { name: "opiumbest S3 us-east-1", url: "https://s3.us-east-1.amazonaws.com/opiumbest/index.html", category: "Opium" },
  { name: "opiumbest GCS", url: "https://storage.googleapis.com/opiumbest/index.html", category: "Opium" },
  { name: "opiumbest svg jsdelivr", url: "https://cdn.jsdelivr.net/gh/OpiumBest/svg/index.svg", category: "Opium" },
  { name: "opiumbest svg statically", url: "https://cdn.statically.io/gh/OpiumBest/svg@main/index.svg", category: "Opium" },
  { name: "opiumbest svg b-cdn", url: "https://jsdelivr.b-cdn.net/gh/OpiumBest/svg/index.svg", category: "Opium" },
  { name: "opiumbest svg esm.sh", url: "https://raw.esm.sh/gh/OpiumBest/svg/index.svg", category: "Opium" },
  { name: "snoopy-college-tricks", url: "https://snoopy-college-tricks.edgeone.dev/apple.svg", category: "Opium" },
  { name: "snoopylearning wasmer", url: "https://snoopylearning.wasmer.app/", category: "Opium" },
  { name: "sheneducation", url: "https://sheneducation.jdronestudio.com/", category: "Opium" },
  { name: "opieducation", url: "https://opieducation.scottbaptist.com/", category: "Opium" },
  { name: "mommy123 kwgranite", url: "https://mommy12345678912.kwgranitecountertops.com/", category: "Opium" },
  { name: "opm amplifyapp", url: "https://opm.d2otav0547hwz0.amplifyapp.com/", category: "Opium" },
  { name: "snoopyacademics", url: "https://snoopyacademics.getinspiredflight.com/", category: "Opium" },
  { name: "opm saintpauljinju", url: "https://opm.saintpauljinju.com/", category: "Opium" },
  { name: "student-3872 khabylamemechanism", url: "https://student-3872.khabylamemechanism.lat/", category: "Opium" },
  { name: "freenbayoungboy", url: "https://freenbayoungboy.sia-tec.org/", category: "Opium" },

  // === Bull33 mirrors ===
  { name: "bull33 jsdelivr", url: "https://cdn.jsdelivr.net/gh/opiumbest/bull33/index.svg", category: "Bull33" },
  { name: "bull33 esm.sh", url: "https://raw.esm.sh/gh/OpiumBest/bull33/index.svg", category: "Bull33" },
  { name: "bull33 statically", url: "https://cdn.statically.io/gh/OpiumBest/bull33@main/index.svg", category: "Bull33" },
  { name: "opiumbull S3", url: "https://s3.amazonaws.com/opiumbull/index.html", category: "Bull33" },
  { name: "opiumbull S3 us-east-1", url: "https://s3.us-east-1.amazonaws.com/opiumbull/index.html", category: "Bull33" },
  { name: "opiumbull GCS", url: "https://storage.googleapis.com/opiumbull/index.html", category: "Bull33" },
  { name: "opiumbull npm jsdelivr", url: "https://cdn.jsdelivr.net/npm/opiumbest/index.svg", category: "Bull33" },
  { name: "classroomlearning npm", url: "https://cdn.jsdelivr.net/npm/classroomlearning/index.svg", category: "Bull33" },

  // === Fern / Bull mirrors ===
  { name: "fernlinks S3", url: "https://s3.amazonaws.com/fernlinks/index.html", category: "Fern/Bull" },
  { name: "classworks S3", url: "https://s3.amazonaws.com/classworks/index.html", category: "Fern/Bull" },
  { name: "bull33 S3 (fern)", url: "https://s3.amazonaws.com/bull33/index.html", category: "Fern/Bull" },
  { name: "bullbestyoutuber S3", url: "https://s3.amazonaws.com/bullbestyoutuber/index.html", category: "Fern/Bull" },
  { name: "bulledu S3", url: "https://s3.amazonaws.com/bulledu/index.html", category: "Fern/Bull" },
  { name: "bullguardian S3", url: "https://s3.amazonaws.com/bullguardian/index.html", category: "Fern/Bull" },
  { name: "bullisgoated S3", url: "https://s3.amazonaws.com/bullisgoated/index.html", category: "Fern/Bull" },
  { name: "bulllightspeed S3", url: "https://s3.amazonaws.com/bulllightspeed/index.html", category: "Fern/Bull" },
  { name: "bullmath S3", url: "https://s3.amazonaws.com/bullmath/index.html", category: "Fern/Bull" },
  { name: "bullubg S3", url: "https://s3.amazonaws.com/bullubg/index.html", category: "Fern/Bull" },
  { name: "iloveliteratures S3", url: "https://s3.amazonaws.com/iloveliteratures/index.html", category: "Fern/Bull" },
  { name: "ilovemaths S3", url: "https://s3.amazonaws.com/ilovemaths/index.html", category: "Fern/Bull" },
  { name: "lsrelay S3", url: "https://s3.amazonaws.com/lsrelay-extension-production/index.html", category: "Fern/Bull" },
  { name: "macrolo S3", url: "https://s3.amazonaws.com/macrolo/index.html", category: "Fern/Bull" },
  { name: "macrologoat S3", url: "https://s3.amazonaws.com/macrologoat/index.html", category: "Fern/Bull" },
  { name: "macrolomath S3", url: "https://s3.amazonaws.com/macrolomath/index.html", category: "Fern/Bull" },
  { name: "deaganfern S3", url: "https://s3.amazonaws.com/deaganfern/index.html", category: "Fern/Bull" },
  { name: "2027g4mes S3", url: "https://s3.amazonaws.com/2027g4mes/index.html", category: "Fern/Bull" },
  { name: "writevc S3", url: "https://s3.amazonaws.com/writevc/index.html", category: "Fern/Bull" },
  { name: "onelastlink S3", url: "https://s3.amazonaws.com/onelastlink/index.html", category: "Fern/Bull" },
  { name: "gclassroom GCS", url: "https://storage.googleapis.com/gclassroom/index.html", category: "Fern/Bull" },

  // === YukiOS mirrors ===
  { name: "yukios jsdelivr", url: "https://cdn.jsdelivr.net/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg", category: "YukiOS" },
  { name: "yukios originfastly", url: "https://originfastly.jsdelivr.net/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg", category: "YukiOS" },
  { name: "yukios gcore", url: "https://gcore.jsdelivr.net/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg", category: "YukiOS" },
  { name: "yukios esm.sh", url: "https://esm.sh/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg", category: "YukiOS" },
  { name: "yukios statically", url: "https://cdn.statically.io/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg", category: "YukiOS" },
  { name: "yukios staticdelivr", url: "https://cdn.staticdelivr.com/gh/reeyuki/YukiOsSingleHtml@main/yukios.svg", category: "YukiOS" },
];

// Inksoft SVG mirrors — there are 100+ of these, so we just show
// a representative sample. Each one is a different obfuscated opium SVG.
const INKSOFT_LINKS: LinkEntry[] = [
  "opium", "opium2", "opiumd0d03", "opiumb5717", "opium99f7f", "opium8267a",
  "opium857fa", "opium54df1", "opiumea84b", "opiumb9e7b", "opiumfbdc1",
  "opium2f8aa", "opium89bef", "opium142d8", "opium408fd", "opium8c41f",
  "opiumbdb5c", "opium6fd68", "opium7311e", "opiumf3afe", "opiumb3f61",
  "opium10f40", "opiumd7178", "opium09b46", "opium5fb18", "opium9477a",
].map((name) => ({
  name: `${name}.svg`,
  url: `https://cdn.inksoft.com/images/clipart/svg/2570/designer2103988394847715328under/${name}.svg`,
  category: "Inksoft SVGs",
}));

const ALL_LINKS = [...LINKS, ...INKSOFT_LINKS];

export function LinksView() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const setView = useNav((s) => s.setView);

  const categories = useMemo(() => {
    const cats = new Set(ALL_LINKS.map((l) => l.category));
    return ["All", ...Array.from(cats)];
  }, []);

  const filtered = useMemo(() => {
    let list = ALL_LINKS;
    if (activeCategory !== "All") list = list.filter((l) => l.category === activeCategory);
    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter((l) => l.name.toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
  }, [query, activeCategory]);

  const openLink = (url: string) => {
    // Open in the Browser view via Scramjet proxy.
    setView("browser");
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("redux-browser-init", { detail: url }));
    }, 50);
    toast.info("Opening link in proxy browser");
  };

  return (
    <div className="fade-in p-6 lg:p-8">
      <div className="mb-6 flex items-center gap-3">
        <Link2 className="h-6 w-6" style={{ color: "var(--accent)" }} />
        <div>
          <h1 className="text-2xl font-bold">Links</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {ALL_LINKS.length} stealth proxy mirrors — opium, bull, fern, yuki. Click to open in the proxy browser.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search links..."
          className="w-full rounded-lg border bg-transparent py-2.5 pl-10 pr-4 text-sm outline-none"
          style={{ borderColor: "var(--border)" }}
        />
      </div>

      {/* Category tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${activeCategory === cat ? "scale-105" : "opacity-60 hover:opacity-100"}`}
            style={{
              borderColor: activeCategory === cat ? "var(--accent)" : "var(--border)",
              color: activeCategory === cat ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {cat} ({activeCategory === "All" ? ALL_LINKS.filter((l) => l.category === cat).length || ALL_LINKS.length : ALL_LINKS.filter((l) => l.category === cat).length})
          </button>
        ))}
      </div>

      {/* Links grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((link, i) => (
          <button
            key={link.url + i}
            onClick={() => openLink(link.url)}
            className="group surface flex items-center gap-3 rounded-lg border p-3 text-left transition-all hover:scale-[1.01]"
            style={{ borderColor: "var(--border)" }}
            title={link.url}
          >
            <span className="text-lg flex-none">🔗</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{link.name}</div>
              <div className="truncate text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{link.url}</div>
            </div>
            <span className="rounded-full border px-2 py-0.5 text-[9px] flex-none" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>{link.category}</span>
            <ExternalLink className="h-3.5 w-3.5 flex-none opacity-0 transition-opacity group-hover:opacity-100" style={{ color: "var(--accent)" }} />
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>No links found.</p>
      )}
    </div>
  );
}
