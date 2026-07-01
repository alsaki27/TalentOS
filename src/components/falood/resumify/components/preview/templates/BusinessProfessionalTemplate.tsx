import React from 'react';
import { ResumeData } from '@/components/falood/resumify/types/resume';
import { Globe, Link2, Code2, Mail, Phone, MapPin } from 'lucide-react';

interface TemplateProps {
  data: ResumeData;
}

export const BusinessProfessionalTemplate: React.FC<TemplateProps> = ({ data }) => {
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

  const getFontSizePx = () => {
    switch (fontSize) {
      case 'small': return '14px';
      case 'large': return '18px';
      default: return '16px';
    }
  };

  return (
    <div
      className={`w-full h-full leading-relaxed `}
      style={{ fontSize: getFontSizePx(), color: colors.text,
        fontFamily: fontFamily || 'Georgia, serif',
        pageBreakInside: 'avoid'
      }}
    >
      {/* Header */}
      <div className="text-center mb-4 pb-4" style={{ borderColor: colors.primary }}>
        <h1
          className="text-2xl font-bold mb-2"
          style={{ color: colors.primary }}
        >
          {personalInfo.fullName || 'Your Name'}
        </h1>
        <h2
          className="text-lg mb-3"
          style={{ color: colors.secondary }}
        >
          {personalInfo.jobTitle || 'Your Job Title'}
        </h2>

        {/* Contact Info */}
        <div className="flex justify-center flex-wrap gap-x-4 gap-y-1 text-xs">
          {personalInfo.email && (
            <div className="flex items-center gap-1">
              <Mail className="w-3 h-3" style={{ color: colors.accent }} />
              <span>{personalInfo.email}</span>
            </div>
          )}
          {personalInfo.phone && (
            <div className="flex items-center gap-1">
              <Phone className="w-3 h-3" style={{ color: colors.accent }} />
              <span>{personalInfo.phone}</span>
            </div>
          )}
          {personalInfo.location && (
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3" style={{ color: colors.accent }} />
              <span>{personalInfo.location}</span>
            </div>
          )}
          {personalInfo.linkedin && (
            <div className="flex items-center gap-1">
              <Link2 className="w-3 h-3" style={{ color: colors.accent }} />
              <a href={personalInfo.linkedin} className="hover:underline">LinkedIn</a>
            </div>
          )}
        </div>

        {/* Links
        {(personalInfo.website || personalInfo.linkedin || personalInfo.github) && (
          <div className="flex justify-center flex-wrap gap-x-4 gap-y-1 text-xs mt-1">
            {personalInfo.website && (
              <div className="flex items-center gap-1">
                <Globe className="w-3 h-3" style={{ color: colors.accent }} />
                <a href={personalInfo.website} className="hover:underline">Portfolio</a>
              </div>
            )}
            {personalInfo.linkedin && (
              <div className="flex items-center gap-1">
                <Link2 className="w-3 h-3" style={{ color: colors.accent }} />
                <a href={personalInfo.linkedin} className="hover:underline">LinkedIn</a>
              </div>
            )}
            {personalInfo.github && (
              <div className="flex items-center gap-1">
                <Code2 className="w-3 h-3" style={{ color: colors.accent }} />
                <a href={personalInfo.github} className="hover:underline">GitHub</a>
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
                  style={{ color: colors.primary, borderColor: colors.primary }}
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
                  style={{ color: colors.primary, borderColor: colors.primary }}
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
                            style={{ color: colors.secondary }}
                          >
                            {exp.company} {exp.location && `• ${exp.location}`}
                          </div>
                        </div>
                        <span
                          className="text-xs font-medium"
                          style={{ color: colors.secondary }}
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
                  style={{ color: colors.primary, borderColor: colors.primary }}
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
                            style={{ color: colors.secondary }}
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
                            style={{ color: colors.secondary }}
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
                  style={{ color: colors.primary, borderColor: colors.primary }}
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
                            style={{ color: colors.secondary }}
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
                          {project.liveUrl && <div><strong>Live:</strong> {project.liveUrl}</div>}
                          {project.githubUrl && <div><strong>Repository:</strong> {project.githubUrl}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section.id === 'skills' && skills && (
              <div>
                <h3
                  className="text-sm font-bold mb-2 pb-1 border-b uppercase tracking-wide"
                  style={{ color: colors.primary, borderColor: colors.primary }}
                >
                  Technical Skills
                </h3>
                {skills.mode === 'simple' ? (
                  <div className="text-xs">
                    {skills.simple.join(' • ')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {skills.categorized.map((category) => (
                      <div key={category.id} className="text-xs">
                        <strong
                          style={{ color: colors.secondary }}
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
                      style={{ color: colors.primary, borderColor: colors.primary }}
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