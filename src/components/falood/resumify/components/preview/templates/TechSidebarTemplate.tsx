import React from 'react';
import { ResumeData } from '@/components/falood/resumify/types/resume';
import { Globe, Link2, Code2, Mail, Phone, MapPin } from 'lucide-react';

interface TemplateProps {
  data: ResumeData;
}

export const TechSidebarTemplate: React.FC<TemplateProps> = ({ data }) => {
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

  const sidebarSections = ['skills', 'education'];
  const mainSections = ['summary', 'experience', 'projects'];

  return (
    <div 
      className={`w-full h-full leading-relaxed `}
      style={{ fontSize: getFontSizePx(), color: colors.text, 
        fontFamily: fontFamily || 'Inter, sans-serif',
        pageBreakInside: 'avoid'
      }}
    >
      {/* Header */}
      <div className="mb-6">
        <h1 
          className="text-2xl font-bold mb-1"
          style={{ color: colors.primary }}
        >
          {personalInfo.fullName || 'Your Name'}
        </h1>
        <h2 
          className="text-lg font-medium mb-3"
          style={{ color: colors.secondary }}
        >
          {personalInfo.jobTitle || 'Your Job Title'}
        </h2>
        
        {/* Contact Info */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
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
      </div>

      {/* Two Column Layout */}
      <div className="flex gap-6">
        {/* Left Sidebar (30%) */}
        <div className="w-[30%] space-y-5">
          {/* Profile Image */}
          {personalInfo.profileImage && (
            <div className="flex justify-center mb-4">
              <img 
                src={personalInfo.profileImage}
                alt="Profile"
                className="w-24 h-24 rounded-full object-cover border-2"
                style={{ borderColor: colors.primary }}
              />
            </div>
          )}

          {/* Sidebar Sections */}
          {visibleSections.filter(s => sidebarSections.includes(s.id)).map(section => (
            <div key={section.id} className="page-break-inside-avoid">
              {section.id === 'skills' && skills && (
                <div>
                  <h3 
                    className="text-sm font-bold mb-2 pb-1 border-b"
                    style={{ color: colors.primary, borderColor: colors.primary }}
                  >
                    SKILLS
                  </h3>
                  {skills.mode === 'simple' ? (
                    <div className="space-y-1">
                      {skills.simple.map((skill) => (
                        <div key={skill} className="text-xs">• {skill}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {skills.categorized.map((category) => (
                        <div key={category.id}>
                          <h4 
                            className="text-xs mb-1"
                            style={{ color: colors.secondary }}
                          >
                            {category.name}
                          </h4>
                          <div className="flex flex-wrap gap-1">
                            {category.skills.map((skill) => (
                              <span 
                                key={skill}
                                className="px-2 py-1 text-xs rounded"
                                style={{ 
                                  backgroundColor: colors.accent + '20',
                                  color: colors.accent,
                                  border: `1px solid ${colors.accent}40`
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
                    className="text-sm font-bold mb-2 pb-1 border-b"
                    style={{ color: colors.primary, borderColor: colors.primary }}
                  >
                    EDUCATION
                  </h3>
                  <div className="space-y-3">
                    {education.map((edu) => (
                      <div key={edu.id}>
                        <h4 className="text-xs font-semibold">{edu.degree}</h4>
                        <div 
                          className="text-xs"
                          style={{ color: colors.secondary }}
                        >
                          {edu.institution}
                        </div>
                        <div className="text-xs">
                          {edu.graduationYear}
                          {edu.gpa && ` • GPA: ${edu.gpa}`}
                        </div>
                        {edu.honors && (
                          <div className="text-xs italic">{edu.honors}</div>
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
                className="text-sm font-bold mb-2 pb-1 border-b"
                style={{ color: colors.primary, borderColor: colors.primary }}
              >
                {customSection.title.toUpperCase()}
              </h3>
              {customSection.type === 'bullets' ? (
                <div className="space-y-1">
                  {formatBulletPoints(customSection.content).map((point, idx) => (
                    <div key={idx} className="text-xs">• {point}</div>
                  ))}
                </div>
              ) : (
                <div className="text-xs">{customSection.content}</div>
              )}
            </div>
          ))}
        </div>

        {/* Right Main Content (70%) */}
        <div className="w-[70%] space-y-5">
          {visibleSections.filter(s => mainSections.includes(s.id)).map(section => (
            <div key={section.id} className="page-break-inside-avoid">
              {section.id === 'summary' && summary && (
                <div>
                  <h3 
                    className="text-sm font-bold mb-2 pb-1 border-b"
                    style={{ color: colors.primary, borderColor: colors.primary }}
                  >
                    PROFESSIONAL SUMMARY
                  </h3>
                  <p className="text-xs leading-relaxed">{summary}</p>
                </div>
              )}

              {section.id === 'experience' && experience.length > 0 && (
                <div>
                  <h3 
                    className="text-sm font-bold mb-3 pb-1 border-b"
                    style={{ color: colors.primary, borderColor: colors.primary }}
                  >
                    EXPERIENCE
                  </h3>
                  <div className="space-y-4">
                    {experience.map((exp) => (
                      <div key={exp.id} className="page-break-inside-avoid">
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="text-xs font-medium">{exp.jobTitle}</h4>
                          <span 
                            className="text-xs"
                            style={{ color: colors.secondary }}
                          >
                            {formatDate(exp.startDate)} - {exp.current ? 'Present' : formatDate(exp.endDate)}
                          </span>
                        </div>
                        <div 
                          className="text-xs mb-1"
                          style={{ color: colors.secondary }}
                        >
                          {exp.company} {exp.location && `• ${exp.location}`}
                        </div>
                        {exp.description && (
                          <p className="text-xs mb-2">{exp.description}</p>
                        )}
                        {exp.bulletPoints.filter(point => point.trim()).length > 0 && (
                          <ul className="space-y-1">
                            {exp.bulletPoints.filter(point => point.trim()).map((point, idx) => (
                              <li key={idx} className="text-xs flex items-start">
                                <span className="mr-2">•</span>
                                <span>{point}</span>
                              </li>
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
                  <h3 
                    className="text-sm font-bold mb-3 pb-1 border-b"
                    style={{ color: colors.primary, borderColor: colors.primary }}
                  >
                    PROJECTS
                  </h3>
                  <div className="space-y-3">
                    {projects.map((project) => (
                      <div key={project.id} className="page-break-inside-avoid">
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="text-xs font-medium">{project.title}</h4>
                          {(project.startDate || project.endDate) && (
                            <span 
                              className="text-xs"
                              style={{ color: colors.secondary }}
                            >
                              {formatDate(project.startDate)} {project.endDate && `- ${formatDate(project.endDate)}`}
                            </span>
                          )}
                        </div>
                        <p className="text-xs mb-2">{project.description}</p>
                        {project.technologies.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {project.technologies.map((tech) => (
                              <span 
                                key={tech}
                                className="px-2 py-1 text-xs rounded"
                                style={{ 
                                  backgroundColor: colors.accent + '20',
                                  color: colors.accent,
                                  border: `1px solid ${colors.accent}40`
                                }}
                              >
                                {tech}
                              </span>
                            ))}
                          </div>
                        )}
                        {(project.liveUrl || project.githubUrl) && (
                          <div className="text-xs space-x-3">
                            {project.liveUrl && <span>Live: {project.liveUrl}</span>}
                            {project.githubUrl && <span>Code: {project.githubUrl}</span>}
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
                className="text-sm font-bold mb-2 pb-1 border-b"
                style={{ color: colors.primary, borderColor: colors.primary }}
              >
                {customSection.title.toUpperCase()}
              </h3>
              {customSection.type === 'bullets' ? (
                <div className="space-y-1">
                  {formatBulletPoints(customSection.content).map((point, idx) => (
                    <div key={idx} className="text-xs flex items-start">
                      <span className="mr-2">•</span>
                      <span>{point}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs">{customSection.content}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};