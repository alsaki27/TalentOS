import React from 'react';
import { ResumeData } from '@/components/falood/resumify/types/resume';
import { Globe, Link2, Code2, Mail, Phone, MapPin } from 'lucide-react';

interface TemplateProps {
  data: ResumeData;
  variant?: 1 | 2 | 3 | 4;
}

export const BusinessProfessionalTemplate: React.FC<TemplateProps> = ({ data, variant = 1 }) => {
  const { personalInfo, summary, experience, education, projects, skills, customSections, sections, colors, fontSize, fontFamily } = data;

  const visibleSections = sections.filter(s => s.visible).sort((a, b) => a.order - b.order);

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + '-01');
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const formatBulletPoints = (content: string) => {
    return content.split('\n').filter(line => line.trim()).map(line =>
      line.trim().replace(/^[•\-\*]\s*/, '')
    );
  };

  const getFontSizePx = () => `${((typeof fontSize === 'number' ? fontSize : 10) * 1.333).toFixed(2)}px`;

  const formatUrl = (url: string | undefined) => {
    if (!url) return '';
    return url.startsWith('http') ? url : `https://${url}`;
  };

  const isExecutive = variant === 2;
  const isModernExecutive = variant === 3;
  const isEditorial = variant === 4;
  const displayColors = isModernExecutive
    ? { primary: '#111111', secondary: '#3f3f46', accent: '#111111', text: '#111111', background: '#ffffff' }
    : colors;
  const sectionHeadingStyle: React.CSSProperties = isModernExecutive
    ? { color: displayColors.primary, borderColor: displayColors.primary, borderLeftWidth: 4, borderBottomWidth: 0, padding: '2px 0 2px 9px', letterSpacing: '0.08em' }
    : isEditorial
      ? { color: displayColors.primary, borderColor: displayColors.accent, borderBottomWidth: 2, letterSpacing: '0.12em' }
      : isExecutive
        ? { color: displayColors.primary, borderColor: displayColors.secondary, borderTopWidth: 1, borderBottomWidth: 1, paddingTop: 4 }
        : { color: displayColors.primary, borderColor: displayColors.primary };

  return (
    <div
      className={`w-full h-full leading-relaxed ${isEditorial ? 'pl-4 border-l-4' : ''}`}
      style={{ fontSize: getFontSizePx(), color: displayColors.text,
        fontFamily: fontFamily || 'Georgia, serif',
        pageBreakInside: 'avoid',
        ...(isEditorial ? { borderColor: displayColors.primary } : {})
      }}
    >
      {/* Header */}
      <div
        className={`${isExecutive || isEditorial || isModernExecutive ? 'text-left' : 'text-center'} mb-4 pb-4 ${isModernExecutive ? 'border-b-[3px]' : ''}`}
        style={{ borderColor: displayColors.primary }}
      >
        <h1
          className={`${isModernExecutive ? 'text-3xl tracking-tight uppercase' : isExecutive ? 'text-2xl border-b-2 pb-2' : 'text-xl'} font-bold mb-2`}
          style={{ color: displayColors.primary, borderColor: displayColors.primary }}
        >
          {personalInfo.fullName || 'Your Name'}
        </h1>
        {personalInfo.jobTitle && (
          <h2
            className={`${isModernExecutive ? 'text-sm uppercase tracking-[0.2em] font-semibold' : 'text-lg'} mb-3 mt-2`}
            style={{ color: displayColors.secondary }}
          >
            {personalInfo.jobTitle}
          </h2>
        )}
        {/* Contact Info */}
        <div className={`flex ${isExecutive || isEditorial || isModernExecutive ? 'justify-start' : 'justify-center'} flex-wrap gap-x-4 gap-y-1 text-xs`}>
          {personalInfo.email && (
            <div className="flex items-center gap-1">
              {/* <Mail className="w-3 h-3" style={{ color: colors.accent }} /> */}
              <span>{personalInfo.email}</span>
            </div>
          )}
          |
          {personalInfo.phone && (
            <div className="flex items-center gap-1">
              {/* <Phone className="w-3 h-3" style={{ color: colors.accent }} /> */}
              <span>{personalInfo.phone}</span>
            </div>
          )}
          |
          {personalInfo.location && (
            <div className="flex items-center gap-1">
              {/* <MapPin className="w-3 h-3" style={{ color: colors.accent }} /> */}
              <span>{personalInfo.location}</span>
            </div>
          )}
          |
          {personalInfo.linkedin && (
            <div className="flex items-center gap-1">
              {/* <Link2 className="w-3 h-3" style={{ color: colors.accent }} /> */}
              <a href={formatUrl(personalInfo.linkedin)} className="hover:underline">LinkedIn</a>
            </div>
          )}
        </div>

        {/* Links
        {(personalInfo.website || personalInfo.linkedin || personalInfo.github) && (
          <div className="flex justify-center flex-wrap gap-x-4 gap-y-1 text-xs mt-1">
            {personalInfo.website && (
              <div className="flex items-center gap-1">
                <Globe className="w-3 h-3" style={{ color: colors.accent }} />
                <a href={formatUrl(personalInfo.website)} className="hover:underline">Portfolio</a>
              </div>
            )}
            {personalInfo.linkedin && (
              <div className="flex items-center gap-1">
                <Link2 className="w-3 h-3" style={{ color: colors.accent }} />
                <a href={formatUrl(personalInfo.linkedin)} className="hover:underline">LinkedIn</a>
              </div>
            )}
            {personalInfo.github && (
              <div className="flex items-center gap-1">
                <Code2 className="w-3 h-3" style={{ color: colors.accent }} />
                <a href={formatUrl(personalInfo.github)} className="hover:underline">GitHub</a>
              </div>
            )}
          </div>
        )} */}
      </div>

      {/* Main Content - Single Column */}
      <div className="space-y-5">
        {visibleSections.map(section => (
          <div key={section.id} className="page-break-inside-avoid">
            {section.id === 'summary' && summary && (
              <div>
                <h3
                  className="text-sm font-bold mb-2 pb-1 border-b uppercase tracking-wide"
                  style={sectionHeadingStyle}
                >
                  Professional Summary
                </h3>
                <p className="text-xs leading-relaxed text-justify">{summary}</p>
              </div>
            )}

            {section.id === 'experience' && experience.length > 0 && (
              <div>
                <h3
                  className="text-sm font-bold mb-3 pb-1 border-b uppercase tracking-wide"
                  style={sectionHeadingStyle}
                >
                  Professional Experience
                </h3>
                <div className="space-y-4">
                  {experience.map((exp) => (
                    <div key={exp.id}>
                      <div className="flex justify-between items-start mb-1">
                        <div>
                          <h4 className="text-xs font-bold">{exp.jobTitle}</h4>
                          <div
                            className="text-xs font-semibold"
                            style={{ color: displayColors.secondary }}
                          >
                            {exp.company} {exp.location && `• ${exp.location}`}
                          </div>
                        </div>
                        <span
                          className="text-xs font-medium"
                          style={{ color: displayColors.secondary }}
                        >
                          {formatDate(exp.startDate)} - {exp.current ? 'Present' : formatDate(exp.endDate)}
                        </span>
                      </div>
                      {exp.description && (
                        <p className="text-xs mb-2 text-justify">{exp.description}</p>
                      )}
                      {exp.bulletPoints.filter(point => point.trim()).length > 0 && (
                        <ul className="space-y-1 ml-4">
                          {exp.bulletPoints.filter(point => point.trim()).map((point, idx) => (
                            <li key={idx} className="text-xs list-disc text-justify">
                              {point}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section.id === 'education' && education.length > 0 && (
              <div>
                <h3
                  className="text-sm font-bold mb-3 pb-1 border-b uppercase tracking-wide"
                  style={sectionHeadingStyle}
                >
                  Education
                </h3>
                <div className="space-y-3">
                  {education.map((edu) => (
                    <div key={edu.id}>
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-xs font-bold">{edu.degree}</h4>
                          <div
                            className="text-xs font-semibold"
                            style={{ color: displayColors.secondary }}
                          >
                            {edu.institution} {edu.location && `• ${edu.location}`}
                          </div>
                          {edu.honors && (
                            <div className="text-xs italic mt-1">{edu.honors}</div>
                          )}
                        </div>
                        <div className="text-right">
                          <div
                            className="text-xs font-medium"
                            style={{ color: displayColors.secondary }}
                          >
                            {edu.graduationYear}
                          </div>
                          {edu.gpa && (
                            <div className="text-xs">GPA: {edu.gpa}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section.id === 'projects' && projects.length > 0 && (
              <div>
                <h3
                  className="text-sm font-bold mb-3 pb-1 border-b uppercase tracking-wide"
                  style={sectionHeadingStyle}
                >
                  Key Projects
                </h3>
                <div className="space-y-3">
                  {projects.map((project) => (
                    <div key={project.id}>
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="text-xs font-bold">{project.title}</h4>
                        {(project.startDate || project.endDate) && (
                          <span
                            className="text-xs font-medium"
                            style={{ color: displayColors.secondary }}
                          >
                            {formatDate(project.startDate)} {project.endDate && `- ${formatDate(project.endDate)}`}
                          </span>
                        )}
                      </div>
                      <p className="text-xs mb-2 text-justify">{project.description}</p>
                      {project.technologies.length > 0 && (
                        <div className="text-xs mb-2">
                          <strong>Technologies:</strong> {project.technologies.join(', ')}
                        </div>
                      )}
                      {(project.liveUrl || project.githubUrl) && (
                        <div className="text-xs">
                          {project.liveUrl && <div><strong>Live:</strong> <a href={formatUrl(project.liveUrl)} className="hover:underline">{project.liveUrl}</a></div>}
                          {project.githubUrl && <div><strong>Repository:</strong> <a href={formatUrl(project.githubUrl)} className="hover:underline">{project.githubUrl}</a></div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section.id === 'skills' && skills && ((skills.mode === 'simple' && skills.simple.length > 0) || (skills.mode === 'categorized' && skills.categorized.length > 0)) && (
              <div>
                <h3
                  className="text-sm font-bold mb-2 pb-1 border-b uppercase tracking-wide"
                  style={sectionHeadingStyle}
                >
                  Technical Skills
                </h3>
                {skills.mode === 'simple' ? (
                  <div className="text-xs">
                    {skills.simple.join(' • ')}
                  </div>
                ) : (
                  <div className="">
                    {skills.categorized.map((category) => (
                      <div key={category.id} className="text-xs">
                        <strong
                          style={{ color: displayColors.primary }}
                        >
                          {category.name}:
                        </strong> {category.skills.join(', ')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {section.id === 'custom' && customSections.length > 0 && (
              <div className="space-y-4">
                {customSections.filter(cs => cs.visible).map((customSection) => (
                  <div key={customSection.id}>
                    <h3
                      className="text-sm font-bold mb-2 pb-1 border-b uppercase tracking-wide"
                      style={sectionHeadingStyle}
                    >
                      {customSection.title}
                    </h3>
                    {customSection.type === 'bullets' ? (
                      <ul className="space-y-1 ml-4">
                        {formatBulletPoints(customSection.content).map((point, idx) => (
                          <li key={idx} className="text-xs list-disc text-justify">{point}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-justify">{customSection.content}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
