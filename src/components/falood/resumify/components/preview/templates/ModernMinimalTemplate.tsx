import React from 'react';
import { ResumeData } from '@/components/falood/resumify/types/resume';
import { Globe, Link2, Code2, Mail, Phone, MapPin } from 'lucide-react';

interface TemplateProps {
  data: ResumeData;
}

export const ModernMinimalTemplate: React.FC<TemplateProps> = ({ data }) => {
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

  const leftSections = ['skills', 'education'];
  const rightSections = ['summary', 'experience', 'projects'];

  return (
    <div 
      className={`w-full h-full leading-relaxed `}
      style={{ fontSize: getFontSizePx(), color: colors.text, 
        fontFamily: fontFamily || 'Poppins, sans-serif',
        pageBreakInside: 'avoid'
      }}
    >
      {/* Header */}
      <div className="mb-6">
        <h1 
          className="text-3xl font-bold mb-2"
          style={{ color: colors.primary }}
        >
          {personalInfo.fullName || 'Your Name'}
        </h1>
        <h2 
          className="text-xl font-medium mb-4"
          style={{ color: colors.secondary }}
        >
          {personalInfo.jobTitle || 'Your Job Title'}
        </h2>
        
        {/* Contact Info */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {personalInfo.email && (
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4" style={{ color: colors.accent }} />
              <span>{personalInfo.email}</span>
            </div>
          )}
          {personalInfo.phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4" style={{ color: colors.accent }} />
              <span>{personalInfo.phone}</span>
            </div>
          )}
          {personalInfo.location && (
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4" style={{ color: colors.accent }} />
              <span>{personalInfo.location}</span>
            </div>
          )}
          {personalInfo.website && (
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" style={{ color: colors.accent }} />
              <a href={personalInfo.website} className="hover:underline">Portfolio</a>
            </div>
          )}
          {personalInfo.linkedin && (
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4" style={{ color: colors.accent }} />
              <a href={personalInfo.linkedin} className="hover:underline">LinkedIn</a>
            </div>
          )}
          {personalInfo.github && (
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4" style={{ color: colors.accent }} />
              <a href={personalInfo.github} className="hover:underline">GitHub</a>
            </div>
          )}
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="flex gap-8">
        {/* Left Column (35%) */}
        <div className="w-[35%] space-y-6">
          {visibleSections.filter(s => leftSections.includes(s.id)).map(section => (
            <div key={section.id} className="page-break-inside-avoid">
              {section.id === 'skills' && skills && (
                <div>
                  <h3 
                    className="text-lg font-bold mb-3"
                    style={{ color: colors.primary }}
                  >
                    Skills
                  </h3>
                  {skills.mode === 'simple' ? (
                    <div className="flex flex-wrap gap-2">
                      {skills.simple.map((skill) => (
                        <span 
                          key={skill}
                          className="px-3 py-1 text-xs rounded-full font-medium"
                          style={{ 
                            backgroundColor: colors.accent + '15',
                            color: colors.accent,
                            border: `1px solid ${colors.accent}30`
                          }}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {skills.categorized.map((category) => (
                        <div key={category.id}>
                          <h4 
                            className="text-sm font-semibold mb-2"
                            style={{ color: colors.secondary }}
                          >
                            {category.name}
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {category.skills.map((skill) => (
                              <span 
                                key={skill}
                                className="px-3 py-1 text-xs rounded-full font-medium"
                                style={{ 
                                  backgroundColor: colors.accent + '15',
                                  color: colors.accent,
                                  border: `1px solid ${colors.accent}30`
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
                    className="text-lg font-bold mb-3"
                    style={{ color: colors.primary }}
                  >
                    Education
                  </h3>
                  <div className="space-y-4">
                    {education.map((edu) => (
                      <div key={edu.id}>
                        <h4 className="text-sm font-semibold">{edu.degree}</h4>
                        <div 
                          className="text-sm font-medium"
                          style={{ color: colors.secondary }}
                        >
                          {edu.institution}
                        </div>
                        <div className="text-xs mt-1">
                          {edu.graduationYear}
                          {edu.location && ` • ${edu.location}`}
                        </div>
                        {edu.gpa && (
                          <div className="text-xs">GPA: {edu.gpa}</div>
                        )}
                        {edu.honors && (
                          <div className="text-xs italic mt-1">{edu.honors}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Custom sections for left column */}
          {customSections.filter(cs => cs.visible && (!cs.placement || cs.placement === 'left')).map((customSection) => (
            <div key={customSection.id} className="page-break-inside-avoid">
              <h3 
                className="text-lg font-bold mb-3"
                style={{ color: colors.primary }}
              >
                {customSection.title}
              </h3>
              {customSection.type === 'bullets' ? (
                <div className="space-y-2">
                  {formatBulletPoints(customSection.content).map((point, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span 
                        className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                        style={{ backgroundColor: colors.accent }}
                      />
                      <span className="text-xs">{point}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-relaxed">{customSection.content}</p>
              )}
            </div>
          ))}
        </div>

        {/* Right Column (65%) */}
        <div className="w-[65%] space-y-6">
          {visibleSections.filter(s => rightSections.includes(s.id)).map(section => (
            <div key={section.id} className="page-break-inside-avoid">
              {section.id === 'summary' && summary && (
                <div>
                  <h3 
                    className="text-lg font-bold mb-3"
                    style={{ color: colors.primary }}
                  >
                    Profile
                  </h3>
                  <p className="text-sm leading-relaxed">{summary}</p>
                </div>
              )}

              {section.id === 'experience' && experience.length > 0 && (
                <div>
                  <h3 
                    className="text-lg font-bold mb-4"
                    style={{ color: colors.primary }}
                  >
                    Experience
                  </h3>
                  <div className="space-y-5">
                    {experience.map((exp) => (
                      <div key={exp.id} className="page-break-inside-avoid">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="text-sm font-bold">{exp.jobTitle}</h4>
                            <div 
                              className="text-sm font-semibold"
                              style={{ color: colors.secondary }}
                            >
                              {exp.company} {exp.location && `• ${exp.location}`}
                            </div>
                          </div>
                          <div 
                            className="text-xs font-medium px-3 py-1 rounded-full"
                            style={{ 
                              backgroundColor: colors.primary + '15',
                              color: colors.primary
                            }}
                          >
                            {formatDate(exp.startDate)} - {exp.current ? 'Present' : formatDate(exp.endDate)}
                          </div>
                        </div>
                        {exp.description && (
                          <p className="text-xs mb-3 leading-relaxed">{exp.description}</p>
                        )}
                        {exp.bulletPoints.filter(point => point.trim()).length > 0 && (
                          <div className="space-y-2">
                            {exp.bulletPoints.filter(point => point.trim()).map((point, idx) => (
                              <div key={idx} className="flex items-start gap-2">
                                <span 
                                  className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                                  style={{ backgroundColor: colors.accent }}
                                />
                                <span className="text-xs">{point}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {section.id === 'projects' && projects.length > 0 && (
                <div>
                  <h3 
                    className="text-lg font-bold mb-4"
                    style={{ color: colors.primary }}
                  >
                    Projects
                  </h3>
                  <div className="space-y-4">
                    {projects.map((project) => (
                      <div key={project.id} className="page-break-inside-avoid">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-sm font-bold">{project.title}</h4>
                          {(project.startDate || project.endDate) && (
                            <div 
                              className="text-xs font-medium px-3 py-1 rounded-full"
                              style={{ 
                                backgroundColor: colors.primary + '15',
                                color: colors.primary
                              }}
                            >
                              {formatDate(project.startDate)} {project.endDate && `- ${formatDate(project.endDate)}`}
                            </div>
                          )}
                        </div>
                        <p className="text-xs mb-3 leading-relaxed">{project.description}</p>
                        {project.technologies.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {project.technologies.map((tech) => (
                              <span 
                                key={tech}
                                className="px-2 py-1 text-xs rounded font-medium"
                                style={{ 
                                  backgroundColor: colors.secondary + '15',
                                  color: colors.secondary
                                }}
                              >
                                {tech}
                              </span>
                            ))}
                          </div>
                        )}
                        {(project.liveUrl || project.githubUrl) && (
                          <div className="text-xs space-x-4">
                            {project.liveUrl && (
                              <span>
                                <strong>Live:</strong> {project.liveUrl}
                              </span>
                            )}
                            {project.githubUrl && (
                              <span>
                                <strong>Code:</strong> {project.githubUrl}
                              </span>
                            )}
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
          {customSections.filter(cs => cs.visible && cs.placement === 'right').map((customSection) => (
            <div key={customSection.id} className="page-break-inside-avoid">
              <h3 
                className="text-lg font-bold mb-3"
                style={{ color: colors.primary }}
              >
                {customSection.title}
              </h3>
              {customSection.type === 'bullets' ? (
                <div className="space-y-2">
                  {formatBulletPoints(customSection.content).map((point, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span 
                        className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                        style={{ backgroundColor: colors.accent }}
                      />
                      <span className="text-xs">{point}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs leading-relaxed">{customSection.content}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};