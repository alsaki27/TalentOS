import React from 'react';
import { Code2, Globe, Link2, Mail, MapPin, Phone } from 'lucide-react';
import { DEFAULT_TITLE_SPACING, normalizeTitleSpacing, type PersonalInfo } from '@/components/falood/resumify/types/resume';

type ContactIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

type ContactItem = {
  key: string;
  value: string;
  label: string;
  href?: string;
  Icon?: ContactIcon;
};

function normalizeContactValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeResumeContactUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  // Resume links are external web profiles. Do not allow a pasted javascript:
  // or other non-web scheme to become an active link in the preview or export.
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return undefined;
  return `https://${trimmed.replace(/^\/+/, '')}`;
}

function getLinkItems(personalInfo: Pick<PersonalInfo, 'website' | 'linkedin' | 'github'>): ContactItem[] {
  const candidates: Array<{ key: string; label: string; value: unknown; Icon: ContactIcon }> = [
    { key: 'website', label: 'Website', value: personalInfo.website, Icon: Globe },
    { key: 'linkedin', label: 'LinkedIn', value: personalInfo.linkedin, Icon: Link2 },
    { key: 'github', label: 'GitHub', value: personalInfo.github, Icon: Code2 },
  ];

  return candidates.flatMap(({ key, label, value, Icon }) => {
    const normalizedValue = normalizeContactValue(value);
    if (!normalizedValue) return [];
    return [{ key, label, value: normalizedValue, href: normalizeResumeContactUrl(normalizedValue), Icon }];
  });
}

function renderContactItems(
  items: ContactItem[],
  options: {
    showIcons?: boolean;
    iconClassName?: string;
    iconColor?: string;
    itemClassName?: string;
    separator?: string;
  } = {},
) {
  const { showIcons = false, iconClassName = 'h-3 w-3', iconColor, itemClassName = '', separator } = options;

  return items.map((item, index) => {
    const Icon = item.Icon;
    return (
      <React.Fragment key={item.key}>
        {index > 0 && separator && (
          <span aria-hidden="true" className="select-none">{separator}</span>
        )}
        <span className={`inline-flex items-center gap-1 ${itemClassName}`.trim()}>
          {showIcons && Icon && <Icon className={iconClassName} style={iconColor ? { color: iconColor } : undefined} />}
          {item.href ? (
            <a href={item.href} className="hover:underline">{item.label}</a>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      </React.Fragment>
    );
  });
}

export function ResumeContactLine({
  personalInfo,
  className = '',
  separator,
  showIcons = false,
  iconClassName,
  iconColor,
}: {
  personalInfo: Pick<PersonalInfo, 'email' | 'phone' | 'location' | 'website' | 'linkedin' | 'github'>;
  className?: string;
  separator?: string;
  showIcons?: boolean;
  iconClassName?: string;
  iconColor?: string;
}) {
  const plainItems: ContactItem[] = [
    { key: 'email', value: normalizeContactValue(personalInfo.email), Icon: Mail },
    { key: 'phone', value: normalizeContactValue(personalInfo.phone), Icon: Phone },
    { key: 'location', value: normalizeContactValue(personalInfo.location), Icon: MapPin },
  ].flatMap((item): ContactItem[] => {
    if (!item.value) return [];
    return [{ ...item, value: item.value, label: item.value }];
  });
  const items = [...plainItems, ...getLinkItems(personalInfo)];
  if (items.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`.trim()}>
      {renderContactItems(items, { showIcons, iconClassName, iconColor, separator })}
    </div>
  );
}

export function ResumeContactLinks({
  personalInfo,
  className = '',
  showIcons = false,
  iconClassName,
  iconColor,
}: {
  personalInfo: Pick<PersonalInfo, 'website' | 'linkedin' | 'github'>;
  className?: string;
  showIcons?: boolean;
  iconClassName?: string;
  iconColor?: string;
}) {
  const items = getLinkItems(personalInfo);
  if (items.length === 0) return null;

  return (
    <div className={className}>
      {renderContactItems(items, { showIcons, iconClassName, iconColor })}
    </div>
  );
}

export function ResumeProjectLinks({
  project,
  className = '',
}: {
  project: { liveUrl?: string; githubUrl?: string };
  className?: string;
}) {
  const links = [
    { key: 'live', label: 'Live Demo', value: project.liveUrl, Icon: Globe },
    { key: 'github', label: 'GitHub Repository', value: project.githubUrl, Icon: Code2 },
  ].flatMap(({ key, label, value, Icon }) => {
    const href = value ? normalizeResumeContactUrl(value) : undefined;
    return href ? [{ key, label, href, Icon }] : [];
  });

  if (links.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`.trim()}>
      {links.map(({ key, label, href, Icon }) => (
        <a key={key} href={href} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
          <Icon className="h-3 w-3" aria-hidden="true" />
          {label}
        </a>
      ))}
    </div>
  );
}

export function getResumeTitleSpacingStyle(value: unknown): React.CSSProperties {
  const spacing = value === undefined ? DEFAULT_TITLE_SPACING : normalizeTitleSpacing(value);
  return { ['--resume-title-spacing' as string]: `${spacing}rem` } as React.CSSProperties;
}

export function getResumeProjectTitle(project: { title?: unknown; name?: unknown }): string {
  for (const value of [project.title, project.name]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function ResumeProjectTitle({
  project,
  as: Element = 'h4',
  className = '',
}: {
  project: { title?: unknown; name?: unknown };
  as?: 'h4' | 'div' | 'span';
  className?: string;
}) {
  const title = getResumeProjectTitle(project);
  if (!title) return null;
  return <Element className={className}>{title}</Element>;
}
