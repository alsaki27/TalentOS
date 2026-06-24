import React from 'react';
import { ResumeData } from '@/components/falood/resumify/types/resume';
import { Globe, Link2, Code2, Mail, Phone, MapPin } from 'lucide-react';

interface TemplateProps {
  data: ResumeData;
}

export const ElegantTimelineTemplate: React.FC<TemplateProps> = ({ data }) => {
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

  const getFontSizeClass = () => {
    switch (fontSize) {
      case 'small': return 'text-xs';
      case 'large': return 'text-sm';
      default: return 'text-xs';
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
      className={`w-full h-full leading-relaxed ${getFontSizeClass()}`}
      style={{ 
        color: colors.text, 
        fontFamily: fontFamily || 'Lato, sans-serif',
        pageBreakInside: 'avoid'
      }}
    >
      {/* Header */}
      <div className="text-center mb-6 pb-4">
        <h1 
          className="text-3xl font-light mb-2"
          style={{ color: colors.primary }}
        >
          {personalInfo.fullName || 'Your Name'}
        </h1>
        <h2 
          className="text-lg font-normal mb-3"
          style={{ color: colors.secondary }}
        >
          {personalInfo.jobTitle || 'Your Job Title'}
        </h2>
        
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

      {/* Single Column with Timeline */}
      <div className="space-y-6">
        {visibleSections.map(section => (
          <div key={section.id} className="page-break-inside-avoid">
            {section.id === 'summary' && summary && (
              <div>
                <h3 
                  className={`${getHeadingSize()} font-semibold mb-3 text-center`}
                  style={{ color: colors.primary }}
                >
                  PROFESSIONAL SUMMARY
                </h3>
                <p className={`${getFontSizeClass()} leading-relaxed text-center max-w-4xl mx-auto`}>{summary}</p>
              </div>
            )}

            {section.id === 'experience' && experience.length > 0 && (
              <div>
                <h3 
                  className={`${getHeadingSize()} font-semibold mb-4 text-center`}
                  style={{ color: colors.primary }}
                >
                  EXPERIENCE
                </h3>
                <div className="relative">
                  <div 
                    className="absolute left-1/2 transform -translate-x-1/2 w-0.5"
                    style={{ 
                      backgroundColor: colors.accent,
                      height: `${Math.min(experience.length * 80, 400)}px`
                    }}
                  />
                  <div className="space-y-3">
                    {experience.map((exp, index) => (
                      <div key={exp.id} className={`flex page-break-inside-avoid ${index % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                        <div className={`w-5/12 ${index % 2 === 0 ? 'pr-6 text-right' : 'pl-6 text-left'}`}>
                          <div className="relative">
                            <div 
                              className={`absolute top-2 w-3 h-3 rounded-full border-2 ${
                                index % 2 === 0 ? '-right-10' : '-left-10'
                              } transform -translate-y-1/2`}
                              style={{ 
                                backgroundColor: colors.background,
                                borderColor: colors.accent
                              }}
                            />
                            <h4 className={`${getFontSizeClass()} font-semibold`}>{exp.jobTitle}</h4>
                            <div 
                              className={`${getFontSizeClass()} font-medium`}
                              style={{ color: colors.secondary }}
                            >
                              {exp.company}
                            </div>
                            <div className="text-xs mb-2">
                              {formatDate(exp.startDate)} - {exp.current ? 'Present' : formatDate(exp.endDate)}
                            </div>
                            {exp.description && <p className="text-xs mb-2">{exp.description}</p>}
                            {exp.bulletPoints.filter(point => point.trim()).length > 0 && (
                              <ul className="space-y-1">
                                {exp.bulletPoints.filter(point => point.trim()).map((point, idx) => (
                                  <li key={idx} className="text-xs">• {point}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Other sections rendered normally */}
            {section.id === 'education' && education.length > 0 && (
              <div>
                <h3 
                  className={`${getHeadingSize()} font-semibold mb-3 text-center`}
                  style={{ color: colors.primary }}
                >
                  EDUCATION
                </h3>
                <div className="flex justify-center">
                  <div className="space-y-3">
                    {education.map((edu) => (
                      <div key={edu.id} className="text-center">
                        <h4 className={`${getFontSizeClass()} font-semibold`}>{edu.degree}</h4>
                        <div style={{ color: colors.secondary }}>{edu.institution}</div>
                        <div className="text-xs">{edu.graduationYear}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {section.id === 'skills' && skills && (
              <div>
                <h3 
                  className={`${getHeadingSize()} font-semibold mb-3 text-center`}
                  style={{ color: colors.primary }}
                >
                  CORE SKILLS
                </h3>
                <div className="flex justify-center">
                  <div className="flex flex-wrap gap-2 justify-center">
                    {skills.mode === 'simple' ? (
                      skills.simple.map((skill) => (
                        <span 
                          key={skill}
                          className="px-3 py-1 text-xs rounded-full"
                          style={{ 
                            backgroundColor: colors.accent + '20',
                            color: colors.accent
                          }}
                        >
                          {skill}
                        </span>
                      ))
                    ) : (
                      skills.categorized.map((category) => 
                        category.skills.map((skill) => (
                          <span 
                            key={skill}
                            className="px-3 py-1 text-xs rounded-full"
                            style={{ 
                              backgroundColor: colors.accent + '20',
                              color: colors.accent
                            }}
                          >
                            {skill}
                          </span>
                        ))
                      )
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Custom Sections */}
            {section.id === 'custom' && customSections.filter(cs => cs.visible).length > 0 && (
              <div className="space-y-4">
                {customSections.filter(cs => cs.visible).map((customSection) => (
                  <div key={customSection.id} className="page-break-inside-avoid">
                    <h3 
                      className={`${getHeadingSize()} font-semibold mb-3 text-center`}
                      style={{ color: colors.primary }}
                    >
                      {customSection.title.toUpperCase()}
                    </h3>
                    <div className="text-center">
                      {customSection.type === 'paragraph' ? (
                        <p className={`${getFontSizeClass()} leading-relaxed`}>{customSection.content}</p>
                      ) : (
                        <ul className="space-y-1 inline-block text-left">
                          {formatBulletPoints(customSection.content).map((point, idx) => (
                            <li key={idx} className={`${getFontSizeClass()}`}>• {point}</li>
                          ))}
                        </ul>
                      )}
                    </div>
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
