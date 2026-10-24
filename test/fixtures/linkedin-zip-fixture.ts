import { buildZip } from './zip-writer';

const PROFILE_CSV = `First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers
Jane,Doe,,,,"Senior Software Engineer","Backend engineer focused on distributed systems.",Software,,"Nairobi, Kenya",,,
`;

const POSITIONS_CSV = `Company Name,Title,Description,Location,Started On,Finished On
Acme Corp,Senior Software Engineer,"Led the payments platform team.",Nairobi,Jan 2021,
Globex,Software Engineer,"Built internal tooling.",Nairobi,Jun 2018,Dec 2020
`;

const EDUCATION_CSV = `School Name,Start Date,End Date,Notes,Degree Name,Activities,Field Of Study
University of Nairobi,2014,2018,,BSc,,Computer Science
`;

const SKILLS_CSV = `Name
TypeScript
PostgreSQL
Distributed Systems
`;

export function buildLinkedInZipFixture(): Buffer {
  return buildZip([
    { name: 'Profile.csv', content: PROFILE_CSV },
    { name: 'Positions.csv', content: POSITIONS_CSV },
    { name: 'Education.csv', content: EDUCATION_CSV },
    { name: 'Skills.csv', content: SKILLS_CSV },
  ]);
}
