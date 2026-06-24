import { ResumeData } from '@/components/falood/resumify/types/resume';

export const exportResumeAsJSON = (resumeData: ResumeData, filename?: string) => {
  try {
    const dataStr = JSON.stringify(resumeData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `resume-${new Date().toISOString().split('T')[0]}.json`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    return true;
  } catch (error) {
    console.error('Error exporting resume:', error);
    return false;
  }
};

export const importResumeFromJSON = (file: File): Promise<ResumeData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const result = e.target?.result;
        if (typeof result === 'string') {
          const resumeData = JSON.parse(result) as ResumeData;
          
          // Validate the imported data has required fields
          if (!resumeData.personalInfo || !resumeData.sections || !resumeData.colors) {
            throw new Error('Invalid resume data format');
          }
          
          resolve(resumeData);
        } else {
          throw new Error('Failed to read file');
        }
      } catch (error) {
        reject(new Error('Invalid JSON file or corrupted resume data'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsText(file);
  });
};