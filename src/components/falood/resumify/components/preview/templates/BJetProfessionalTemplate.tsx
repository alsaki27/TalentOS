import React from 'react';
import { ResumeData } from '@/components/falood/resumify/types/resume';
import { Globe, Link2, Code2 } from 'lucide-react';

interface TemplateProps {
  data: ResumeData;
}

export const BJetProfessionalTemplate: React.FC<TemplateProps> = ({ data }) => {
  const { personalInfo, education, experience, projects, skills, customSections, colors, fontSize, fontFamily } = data;

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + '-01');
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  const getFontSizeClass = () => {
    switch (fontSize) {
      case 'small': return 'text-[10px]';
      case 'large': return 'text-xs';
      default: return 'text-[11px]';
    }
  };

  // Get custom sections by type
  const getCustomSectionsByTitle = (titleMatch: string) => {
    return customSections.filter(cs => 
      cs.visible && cs.title.toLowerCase().includes(titleMatch.toLowerCase())
    );
  };

  const trainingSections = getCustomSectionsByTitle('training');
  const languageSections = getCustomSectionsByTitle('language');
  const certificationSections = getCustomSectionsByTitle('certification');
  const achievementsSections = getCustomSectionsByTitle('achievement');

  return (
    <div 
      className={`w-full h-full ${getFontSizeClass()}`}
      style={{ 
        fontFamily: fontFamily || 'Arial, sans-serif',
        color: colors.text,
        lineHeight: '1.4'
      }}
    >
      {/* Header Logo */}
      <div className="flex justify-end mb-3">
        <div 
          className="px-3 py-1 text-white font-bold text-sm"
          style={{ backgroundColor: colors.primary }}
        >
          Career Center
        </div>
      </div>

      {/* Basic Information */}
      <div className="mb-4">
        <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
          Basic Information 基本情報
        </h2>
        <div className="flex gap-4">
          <table className="border-collapse w-full" style={{ border: `1px solid ${colors.secondary}` }}>
            <tbody>
              <tr>
                <td 
                  className="font-semibold p-2 border" 
                  style={{ 
                    width: '30%',
                    backgroundColor: colors.accent + '30',
                    borderColor: colors.secondary 
                  }}
                >
                  Name
                </td>
                <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                  {personalInfo.fullName || 'Your Name'}
                </td>
                {personalInfo.profileImage && (
                  <td className="border p-2" rowSpan={6} style={{ width: '120px', borderColor: colors.secondary }}>
                    <img 
                      src={personalInfo.profileImage}
                      alt="Profile"
                      className="w-full h-auto object-cover"
                      style={{ maxHeight: '140px' }}
                    />
                  </td>
                )}
              </tr>
              {personalInfo.birthDate && (
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    Birth date
                  </td>
                  <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                    {personalInfo.birthDate}
                  </td>
                </tr>
              )}
              <tr>
                <td 
                  className="font-semibold p-2 border" 
                  style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                >
                  Current Address
                </td>
                <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                  {personalInfo.location || ''}
                </td>
              </tr>
              <tr>
                <td 
                  className="font-semibold p-2 border" 
                  style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                >
                  Contact Number
                </td>
                <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                  {personalInfo.phone || ''}
                </td>
              </tr>
              <tr>
                <td 
                  className="font-semibold p-2 border" 
                  style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                >
                  E-mail
                </td>
                <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                  {personalInfo.email || ''}
                </td>
              </tr>
              <tr>
                <td 
                  className="font-semibold p-2 border" 
                  style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                >
                  Portfolio link
                </td>
                <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                  <div className="space-y-1">
                    {personalInfo.website && (
                      <div className="flex items-center gap-1">
                        <Globe className="w-3 h-3" />
                        <span className="text-blue-600 underline text-[10px]">{personalInfo.website}</span>
                      </div>
                    )}
                    {personalInfo.github && (
                      <div className="flex items-center gap-1">
                        <span className="font-medium">GitHub:</span>
                        <span className="text-blue-600 underline text-[10px]">{personalInfo.github}</span>
                      </div>
                    )}
                    {personalInfo.linkedin && (
                      <div className="flex items-center gap-1">
                        <span className="font-medium">LinkedIn:</span>
                        <span className="text-blue-600 underline text-[10px]">{personalInfo.linkedin}</span>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Academic Background */}
      {education.length > 0 && (
        <div className="mb-4 page-break-inside-avoid">
          <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
            Academic Background 学歴
          </h2>
          {education.map((edu, index) => (
            <table key={edu.id} className={`border-collapse w-full ${index > 0 ? 'mt-3' : ''}`} style={{ border: `1px solid ${colors.secondary}` }}>
              <tbody>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ 
                      width: '25%',
                      backgroundColor: colors.accent + '30',
                      borderColor: colors.secondary 
                    }}
                  >
                    Degree
                  </td>
                  <td className="p-2 border" colSpan={3} style={{ borderColor: colors.secondary }}>
                    {edu.degree}
                  </td>
                </tr>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    University Name
                  </td>
                  <td className="p-2 border" colSpan={3} style={{ borderColor: colors.secondary }}>
                    {edu.institution}
                  </td>
                </tr>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    Duration
                  </td>
                  <td className="p-2 border" style={{ width: '25%', borderColor: colors.secondary }}>
                    {edu.graduationYear}
                  </td>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ width: '15%', backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    CGPA
                  </td>
                  <td className="p-2 border" style={{ width: '35%', borderColor: colors.secondary }}>
                    {edu.gpa || ''}
                  </td>
                </tr>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    Passing Date
                  </td>
                  <td className="p-2 border" colSpan={3} style={{ borderColor: colors.secondary }}>
                    {edu.graduationYear}
                    {edu.honors && ` • ${edu.honors}`}
                  </td>
                </tr>
              </tbody>
            </table>
          ))}
        </div>
      )}

      {/* Professional Working Experience */}
      {experience.length > 0 && (
        <div className="mb-4 page-break-inside-avoid">
          <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
            Professional Working Experience 職歴
          </h2>
          {experience.map((exp, index) => (
            <table key={exp.id} className={`border-collapse w-full ${index > 0 ? 'mt-3' : ''}`} style={{ border: `1px solid ${colors.secondary}` }}>
              <tbody>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ 
                      width: '30%',
                      backgroundColor: colors.accent + '30',
                      borderColor: colors.secondary 
                    }}
                  >
                    Company Name
                  </td>
                  <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                    {exp.company}
                  </td>
                </tr>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    Job Title
                  </td>
                  <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                    {exp.jobTitle}
                  </td>
                </tr>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    Job Responsibilities
                  </td>
                  <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                    {exp.description}
                    {exp.bulletPoints.filter(p => p.trim()).length > 0 && (
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        {exp.bulletPoints.filter(p => p.trim()).map((point, idx) => (
                          <li key={idx}>{point}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    Technology / Language Used
                  </td>
                  <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                    {exp.location || ''}
                  </td>
                </tr>
                <tr>
                  <td 
                    className="font-semibold p-2 border" 
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                  >
                    Duration
                  </td>
                  <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                    {formatDate(exp.startDate)} - {exp.current ? 'Present' : formatDate(exp.endDate)}
                  </td>
                </tr>
              </tbody>
            </table>
          ))}
        </div>
      )}

      {/* Technical Skills */}
      {skills && skills.categorized.length > 0 && (
        <div className="mb-4 page-break-inside-avoid">
          <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
            Technical Skills 技術スキル
          </h2>
          <p className="text-[9px] mb-2" style={{ color: colors.secondary }}>
            S = Team Lead or Managerial Level experience, A = Professional project Experience, B=Highly confident skill, 
            C = Personal / Academic Project Experience, D = Theoretical Knowledge
          </p>
          <table className="border-collapse w-full" style={{ border: `1px solid ${colors.secondary}` }}>
            <thead>
              <tr>
                {skills.categorized.slice(0, 4).map((category) => (
                  <React.Fragment key={category.id}>
                    <th 
                      className="font-semibold p-2 border text-center"
                      style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary }}
                    >
                      {category.name}
                    </th>
                    <th 
                      className="font-semibold p-2 border text-center"
                      style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary, width: '80px' }}
                    >
                      Skill Level
                    </th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(...skills.categorized.slice(0, 4).map(c => c.skills.length)) }).map((_, rowIndex) => (
                <tr key={rowIndex}>
                  {skills.categorized.slice(0, 4).map((category) => (
                    <React.Fragment key={`${category.id}-${rowIndex}`}>
                      <td className="p-2 border" style={{ borderColor: colors.secondary }}>
                        {category.skills[rowIndex] || ''}
                      </td>
                      <td className="p-2 border text-center" style={{ borderColor: colors.secondary }}>
                        {category.skills[rowIndex] ? 'B' : ''}
                      </td>
                    </React.Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Professional Project Experience */}
      {projects.length > 0 && (
        <div className="mb-4 page-break-inside-avoid">
          <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
            Professional Project Experience 仕事としての経験
          </h2>
          {projects.map((project, index) => (
            <table key={project.id} className={`border-collapse w-full ${index > 0 ? 'mt-3' : ''}`} style={{ border: `1px solid ${colors.secondary}` }}>
              <thead>
                <tr>
                  <th 
                    className="font-semibold p-2 border"
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary, width: '20%' }}
                  >
                    Duration
                  </th>
                  <th 
                    className="font-semibold p-2 border"
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary, width: '40%' }}
                  >
                    Project Details
                  </th>
                  <th 
                    className="font-semibold p-2 border"
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary, width: '20%' }}
                  >
                    Technology Used
                  </th>
                  <th 
                    className="font-semibold p-2 border"
                    style={{ backgroundColor: colors.accent + '30', borderColor: colors.secondary, width: '20%' }}
                  >
                    Your Role
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-2 border align-top" style={{ borderColor: colors.secondary }}>
                    {project.startDate && formatDate(project.startDate)}
                    {project.endDate && ` - ${formatDate(project.endDate)}`}
                  </td>
                  <td className="p-2 border align-top" style={{ borderColor: colors.secondary }}>
                    <div className="space-y-1">
                      <div><span className="font-medium">Project Title:</span> {project.title}</div>
                      <div><span className="font-medium">Project Overview:</span> {project.description}</div>
                      {project.liveUrl && (
                        <div><span className="font-medium">Project Link:</span> {project.liveUrl}</div>
                      )}
                    </div>
                  </td>
                  <td className="p-2 border align-top" style={{ borderColor: colors.secondary }}>
                    {project.technologies.join(', ')}
                  </td>
                  <td className="p-2 border align-top" style={{ borderColor: colors.secondary }}>
                    {/* Role information can be added here */}
                  </td>
                </tr>
              </tbody>
            </table>
          ))}
        </div>
      )}

      {/* Training */}
      {trainingSections.map((section) => (
        <div key={section.id} className="mb-4 page-break-inside-avoid">
          <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
            {section.title}
          </h2>
          <div className="whitespace-pre-wrap">{section.content}</div>
        </div>
      ))}

      {/* Language Skills */}
      {languageSections.map((section) => (
        <div key={section.id} className="mb-4 page-break-inside-avoid">
          <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
            {section.title}
          </h2>
          <div className="whitespace-pre-wrap">{section.content}</div>
        </div>
      ))}

      {/* Professional Certification */}
      {certificationSections.map((section) => (
        <div key={section.id} className="mb-4 page-break-inside-avoid">
          <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
            {section.title}
          </h2>
          <div className="whitespace-pre-wrap">{section.content}</div>
        </div>
      ))}

      {/* Special Achievements */}
      {achievementsSections.map((section) => (
        <div key={section.id} className="mb-4 page-break-inside-avoid">
          <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
            {section.title}
          </h2>
          <div className="whitespace-pre-wrap">{section.content}</div>
        </div>
      ))}

      {/* Other Custom Sections */}
      {customSections
        .filter(cs => 
          cs.visible && 
          !cs.title.toLowerCase().includes('training') &&
          !cs.title.toLowerCase().includes('language') &&
          !cs.title.toLowerCase().includes('certification') &&
          !cs.title.toLowerCase().includes('achievement')
        )
        .map((section) => (
          <div key={section.id} className="mb-4 page-break-inside-avoid">
            <h2 className="font-bold mb-2" style={{ fontSize: '14px', color: colors.text }}>
              {section.title}
            </h2>
            {section.type === 'bullets' ? (
              <ul className="list-disc list-inside space-y-1">
                {section.content.split('\n').filter(line => line.trim()).map((point, idx) => (
                  <li key={idx}>{point.replace(/^[•\-\*]\s*/, '')}</li>
                ))}
              </ul>
            ) : (
              <div className="whitespace-pre-wrap">{section.content}</div>
            )}
          </div>
        ))}
    </div>
  );
};
