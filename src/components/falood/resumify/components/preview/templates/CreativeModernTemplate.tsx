import React from 'react';
import { ResumeData } from '@/components/falood/resumify/types/resume';
import { Globe, Link2, Code2, Mail, Phone, MapPin } from 'lucide-react';

interface TemplateProps {
  data: ResumeData;
}

export const CreativeModernTemplate: React.FC<TemplateProps> = ({ data }) => {
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

  const getHeadingSize = () => {
    switch (fontSize) {
      case 'small': return 'text-sm';
      case 'large': return 'text-base';
      default: return 'text-sm';
    }
  };

  return (
    <div 
      className={`w-full h-full leading-relaxed `}
      style={{ fontSize: getFontSizePx(), color: colors.text, 
        fontFamily: fontFamily || 'Source Sans Pro, sans-serif',
        pageBreakInside: 'avoid'
      }}
    >
      {/* Creative Header */}
      <div 
        className="p-6 mb-6 rounded-lg"
        style={{ background: `linear-gradient(135deg, ${colors.primary}, ${colors.accent})` }}
      >
        <div className="text-white">
          <h1 className="text-3xl font-bold mb-1">
            {personalInfo.fullName || 'Your Name'}
          </h1>
          <h2 className="text-xl mb-3 opacity-90">
            {personalInfo.jobTitle || 'Your Job Title'}
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm opacity-90">
            {personalInfo.email && (
              <div className="flex items-center gap-1">
                <Mail className="w-3 h-3" />
                <span>{personalInfo.email}</span>
              </div>
            )}
            {personalInfo.phone && (
              <div className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                <span>{personalInfo.phone}</span>
              </div>
            )}
            {personalInfo.location && (
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                <span>{personalInfo.location}</span>
              </div>
            )}
            {personalInfo.website && (
              <div className="flex items-center gap-1">
                <Globe className="w-3 h-3" />
                <a href={personalInfo.website} className="hover:underline text-white">Portfolio</a>
              </div>
            )}
            {personalInfo.linkedin && (
              <div className="flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                <a href={personalInfo.linkedin} className="hover:underline text-white">LinkedIn</a>
              </div>
            )}
            {personalInfo.github && (
              <div className="flex items-center gap-1">
                <Code2 className="w-3 h-3" />
                <a href={personalInfo.github} className="hover:underline text-white">GitHub</a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two Column Creative Layout */}
      <div className="flex gap-8 px-2">
        {/* Left Sidebar */}
        <div className="w-1/3 space-y-6">
          {visibleSections.filter(s => ['skills', 'education'].includes(s.id)).map(section => (
            <div key={section.id} className="page-break-inside-avoid">
              {section.id === 'skills' && skills && (
                <div>
                  <h3 
                    className={`${getHeadingSize()} font-bold mb-3 pb-2 border-b-2`}
                    style={{ color: colors.primary, borderColor: colors.accent }}
                  >
                    SKILLS
                  </h3>
                  {skills.mode === 'simple' ? (
                    <div className="flex flex-wrap gap-1.5">
                      {skills.simple.map((skill) => (
                        <span 
                          key={skill} 
                          className="px-2 py-1 rounded-md text-xs font-medium"
                          style={{ 
                            backgroundColor: colors.accent + '20', 
                            color: colors.accent,
                            border: `1px solid ${colors.accent}30`
                          }}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {skills.categorized.map((category) => (
                        <div key={category.id}>
                          <h4 className="text-xs font-bold mb-1.5" style={{ color: colors.primary }}>
                            {category.name}
                          </h4>
                          <div className="flex flex-wrap gap-1">
                            {category.skills.map((skill) => (
                              <span 
                                key={skill}
                                className="px-2 py-0.5 rounded text-xs font-medium"
                                style={{ 
                                  backgroundColor: colors.accent + '15', 
                                  color: colors.accent,
                                  border: `1px solid ${colors.accent}25`
                                }}
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {section.id === 'education' && education.length > 0 && (
                <div>
                  <h3 
                    className={`${getHeadingSize()} font-bold mb-3 pb-2 border-b-2`}
                    style={{ color: colors.primary, borderColor: colors.accent }}
                  >
                    EDUCATION
                  </h3>
                  <div className="space-y-3">
                    {education.map((edu) => (
                      <div key={edu.id}>
                        <h4 className={` font-semibold`}>{edu.degree}</h4>
                        <div className={``} style={{ color: colors.secondary }}>
                          {edu.institution}
                        </div>
                        <div className="text-xs">{edu.graduationYear}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Custom sections for left column */}
          {customSections.filter(cs => cs.visible && cs.placement === 'left').map((customSection) => (
            <div key={customSection.id} className="page-break-inside-avoid">
              <h3 
                className={`${getHeadingSize()} font-bold mb-3 pb-2 border-b-2`}
                style={{ color: colors.primary, borderColor: colors.accent }}
              >
                {customSection.title.toUpperCase()}
              </h3>
              {customSection.type === 'paragraph' ? (
                <p className={` leading-relaxed`}>{customSection.content}</p>
              ) : (
                <ul className="space-y-1">
                  {formatBulletPoints(customSection.content).map((point, idx) => (
                    <li key={idx} className={``}>• {point}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* Right Main Content */}
        <div className="w-2/3 space-y-6">
          {visibleSections.filter(s => ['summary', 'experience', 'projects'].includes(s.id)).map(section => (
            <div key={section.id} className="page-break-inside-avoid">
              {section.id === 'summary' && summary && (
                <div>
                  <h3 className={`${getHeadingSize()} font-bold mb-3`} style={{ color: colors.primary }}>
                    ABOUT ME
                  </h3>
                  <p className={` leading-relaxed`}>{summary}</p>
                </div>
              )}

              {section.id === 'experience' && experience.length > 0 && (
                <div>
                  <h3 className={`${getHeadingSize()} font-bold mb-4`} style={{ color: colors.primary }}>
                    EXPERIENCE
                  </h3>
                  <div className="space-y-4">
                    {experience.map((exp) => (
                      <div key={exp.id} className="relative pl-6 page-break-inside-avoid">
                        <div 
                          className="absolute left-0 top-2 w-3 h-3 rounded-full"
                          style={{ backgroundColor: colors.accent }}
                        />
                        <h4 className={` font-bold`}>{exp.jobTitle}</h4>
                        <div className={``} style={{ color: colors.secondary }}>
                          {exp.company} • {formatDate(exp.startDate)} - {exp.current ? 'Present' : formatDate(exp.endDate)}
                        </div>
                        {exp.description && <p className="text-xs mt-1">{exp.description}</p>}
                        {exp.bulletPoints.filter(point => point.trim()).length > 0 && (
                          <ul className="space-y-1 mt-2">
                            {exp.bulletPoints.filter(point => point.trim()).map((point, idx) => (
                              <li key={idx} className="text-xs">• {point}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {section.id === 'projects' && projects.length > 0 && (
                <div>
                  <h3 className={`${getHeadingSize()} font-bold mb-4`} style={{ color: colors.primary }}>
                    PROJECTS
                  </h3>
                  <div className="space-y-3">
                    {projects.map((project) => (
                      <div key={project.id} className="page-break-inside-avoid">
                        <h4 className={` font-bold`}>{project.title}</h4>
                        <p className="text-xs mb-2">{project.description}</p>
                        {project.technologies.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {project.technologies.map((tech) => (
                              <span 
                                key={tech}
                                className="px-2 py-1 text-xs rounded"
                                style={{ backgroundColor: colors.primary + '15', color: colors.primary }}
                              >
                                {tech}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Custom sections for right column */}
          {customSections.filter(cs => cs.visible && (!cs.placement || cs.placement === 'right')).map((customSection) => (
            <div key={customSection.id} className="page-break-inside-avoid">
              <h3 className={`${getHeadingSize()} font-bold mb-3`} style={{ color: colors.primary }}>
                {customSection.title.toUpperCase()}
              </h3>
              {customSection.type === 'paragraph' ? (
                <p className={` leading-relaxed`}>{customSection.content}</p>
              ) : (
                <ul className="space-y-1">
                  {formatBulletPoints(customSection.content).map((point, idx) => (
                    <li key={idx} className={``}>• {point}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};