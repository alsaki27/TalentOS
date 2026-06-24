import React from 'react';
import { useResume } from '@/components/falood/resumify/contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export const SummaryForm: React.FC = () => {
  const { state, updateSummary } = useResume();
  const { summary } = state.resumeData;

  const wordCount = summary.split(' ').filter(word => word.length > 0).length;
  const maxWords = 300;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Professional Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="summary">
            Summary
            <span className="text-xs text-muted-foreground ml-2">
              ({wordCount}/{maxWords} words)
            </span>
          </Label>
          <Textarea
            id="summary"
            placeholder="Write a compelling professional summary that highlights your key skills, experience, and career objectives. This section should give employers a quick overview of what makes you the ideal candidate."
            value={summary}
            onChange={(e) => updateSummary(e.target.value)}
            rows={6}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Keep it concise and impactful. Focus on your most relevant achievements and skills.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};