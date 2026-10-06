import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('teaching_assignment')
export class TeachingAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'group_id', type: 'uuid' })
  groupId: string;

  @Column({ name: 'professor_id', type: 'uuid' })
  professorId: string;

  @Column({ name: 'valid_from' })
  validFrom: Date;

  @Column({ name: 'valid_to', type: 'timestamptz', nullable: true })
  validTo: Date | null;
}
