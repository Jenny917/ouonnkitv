import { ExternalLink } from 'lucide-react'
import { Badge } from '@/shared/components/ui/badge'
import type { VersionUpdate } from '@/shared/store/versionStore'
import { VersionCategoryCard } from './VersionCategoryCard'

interface VersionDetailProps {
  version: VersionUpdate
}

export function VersionDetail({ version }: VersionDetailProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1 px-1">
        <h3 className="text-lg font-semibold">{version.title}</h3>
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Badge variant="secondary" className="text-xs font-medium">
            v{version.version}
          </Badge>
          <span>{version.date}</span>
        </div>
      </div>

      <div className="space-y-3">
        <VersionCategoryCard category="features" items={version.features} />
        <VersionCategoryCard category="fixes" items={version.fixes ?? []} />
        <VersionCategoryCard category="breaking" items={version.breaking ?? []} />
      </div>

      {version.links && version.links.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1 pt-1">
          {version.links.map(link => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="border-border/70 bg-muted/35 hover:bg-muted/55 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
            >
              {link.label}
              <ExternalLink className="size-3.5" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
