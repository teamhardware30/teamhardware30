import { ParsedResume } from '../../src/common/schemas/parsed-resume.schema';

export function makeParsedResume(): ParsedResume {
  return {
    contact: {
      full_name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+254 700 000 000',
      location: 'Nairobi, Kenya',
      links: ['https://www.linkedin.com/in/janedoe'],
    },
    headline: 'Senior Software Engineer',
    summary: 'Backend engineer focused on distributed systems.',
    experiences: [
      {
        title: 'Senior Software Engineer',
        company: 'Acme Corp',
        location: 'Nairobi',
        start: '2021-01',
        end: 'present',
        bullets: ['Led the payments platform team.', 'Improved service reliability.'],
      },
    ],
    education: [
      {
        school: 'University of Nairobi',
        degree: 'BSc',
        field: 'Computer Science',
        start: '2014',
        end: '2018',
      },
    ],
    skills: [
      { name: 'TypeScript', kind: 'tool' },
      { name: 'PostgreSQL', kind: 'tool' },
    ],
    certifications: ['AWS Certified Solutions Architect'],
    languages: ['English', 'Swahili'],
    total_years_experience: 8,
    seniority: 'senior',
  };
}
